"""Feed as reports (design 8.10, api.md 信息流改成报告).

feed_brief (daily): one `kind=brief` card. Material: the paper picks (feed.pick_papers) and web news (news.py,
general queries plus one per lab). Claude (no tools) writes the sections from that material only; each event is
written once (api.md 补充 1–2: one line per item, <= BODY_BUDGET_CHARS of text).

Claude never copies links: every news item gets a short ref (n1, n2, ...) and Claude cites refs, which the
script maps back to the material's links (a long id copied wrong once voided a whole brief). A ref that is not
in the material is still an error.

feed_watch (every `every_hours`): per lab in `labs`, news since the last successful run;
Claude keeps only substantive events, rumors and leaks included (api.md 补充 3), each becomes one `kind=alert`
card titled 【传闻】/【确认】. Reported event keys ("<lab>:<event>", "+:confirmed" once confirmed) are kept
locally in STATE_DIR/watch.json so an event is reported once as a rumor and once more when confirmed.

Cited Google News links are resolved to the publisher's URL before the cards are written (news.resolve).

A material source that fails is skipped (health=warn, the result names it); the report is still written.
"""
import json
import logging
import re
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo

from mojito_worker import claude, feed, health, news, subscriptions, taste
from mojito_worker.config import STATE_DIR, TIMEZONE
from mojito_worker.hub import Hub
from mojito_worker.i18n import join, say
from mojito_worker.prompting import dump, now_context, short_date, user_text_rules
from mojito_worker.validate import ValidationError, require_fields, require_nonempty_str

log = logging.getLogger("mojito_worker.reports")

BRIEF_WINDOW = timedelta(hours=24)
# Google News queries for the brief's general sections; labs get their own query each.
BRIEF_NEWS_QUERIES = ("new AI model release", "open-source AI model", "OpenAI OR Anthropic OR Gemini OR Meta AI",
                      "大模型 发布", "AI 开源 模型")
SECTION_ITEMS = 4
SUMMARY_LINES = 3
SUMMARY_MAX_CHARS = 800
BODY_MAX_CHARS = 12000
BODY_BUDGET_CHARS = 4000     # the brief's text as read, link targets not counted (api.md 补充 1)
LINE_CHARS = 50
LINK_TARGET = re.compile(r"\]\([^)]*\)")
CITE_TITLE_CHARS = 40
PAPER_DETAIL_CHARS = 300
CARD_STATUSES = ("new", "saved", "dismissed")
CARD_SCAN_LIMIT = 200
WATCH_STATE = STATE_DIR / "watch.json"
REPORTED_KEEP = 300

NEWS_SECTIONS = ("models", "open_source", "industry")
STATUSES = ("rumor", "confirmed")
TITLE_PREFIX = {"rumor": "【传闻】", "confirmed": "【确认】"}
CONFIRMED_SUFFIX = ":confirmed"


def _aliases(lab: str) -> list[str]:
    return [a.strip() for a in lab.split("/")]


def _lab_news_query(lab: str) -> str:
    return "(" + " OR ".join(f'"{a}"' for a in _aliases(lab)) + ") AI"


# ---------------------------------------------------------------- material

@dataclass
class Material:
    news: dict[str, list[dict]]      # query or lab -> articles
    failed: list[str]                # "<source>: <error>" for the result and the body footer
    refs: dict[str, str]             # short ref Claude cites (n1, n2, ...) -> material url; set by number()

    def number(self) -> None:
        """Give each distinct material url one ref, numbered in prompt order."""
        ref_of: dict[str, str] = {}
        for items in self.news.values():
            for item in items:
                if item["url"] not in ref_of:
                    ref_of[item["url"]] = f"n{len(ref_of) + 1}"
        self.refs = {ref: url for url, ref in ref_of.items()}

    def shown(self) -> dict[str, list[dict]]:
        """The news groups as Claude sees them: url replaced by ref."""
        ref_of = {url: ref for ref, url in self.refs.items()}
        return {group: [{"ref": ref_of[item["url"]], **{k: v for k, v in item.items() if k != "url"}} for item in items]
                for group, items in self.news.items()}

    def _named(self, lang: str) -> dict[str, tuple[str | None, str]]:
        """material url -> (who published it, or None when the feed gave no name; what it is)."""
        named = {}
        for arts in self.news.values():
            for a in arts:  # Google News titles end with " - <source>"
                named[a["url"]] = (a["source"], a["title"].removesuffix(f" - {a['source']}"))
        return named

    def cite(self, lang: str, refs: list[str]) -> dict[str, "Citation"]:
        """ref -> how a report cites that material item (api.md 补充 5): named by the material's own source
        name (the domain when the feed gave none), pointing at the resolved URL."""
        resolved = news.resolve([self.refs[r] for r in refs])
        named = self._named(lang)
        cites = {}
        for r in refs:
            url = self.refs[r]
            name, title = named[url]
            cites[r] = Citation(name=name if name else urlsplit(resolved[url]).netloc.removeprefix("www."),
                                title=title, url=resolved[url])
        return cites


@dataclass(frozen=True)
class Citation:
    name: str    # outlet or domain
    title: str   # the article / post it links to
    url: str     # publisher URL (Google News links resolved)


def _link(text: str, url: str) -> str:
    """A Markdown link whose text cannot close early."""
    return f"[{text.replace('[', '(').replace(']', ')')}]({url})"


def _short(text: str) -> str:
    text = text.strip()
    return text if len(text) <= CITE_TITLE_CHARS else text[:CITE_TITLE_CHARS - 1].rstrip(" -–—:：,，") + "…"


def _gather(lang: str, news_queries: dict[str, str], since: datetime) -> Material:
    """news_queries: label -> Google News query. Each source failing on its own is recorded, not raised."""
    m = Material(news={}, failed=[], refs={})
    try:
        for label, query in news_queries.items():
            m.news[label] = news.search(query, since)
    except Exception as e:
        log.exception("news search failed")
        m.news = {}
        m.failed.append(f"{say(lang, '新闻')}: {type(e).__name__}: {e}")
    m.number()
    return m


def _check_refs(refs: list[str], allowed: set[str], where: str) -> None:
    unknown = [r for r in refs if r not in allowed]
    if unknown:
        raise ValidationError(f"{where}: refs not in the material: {unknown}")


# ---------------------------------------------------------------- feed_brief

_ITEMS = {"type": "array", "maxItems": SECTION_ITEMS, "items": {
    "type": "object",
    "properties": {"text": {"type": "string"}, "ref": {"type": "string"}},
    "required": ["text", "ref"],
    "additionalProperties": False,
}}

BRIEF_SCHEMA = {
    "type": "object",
    "properties": {
        "summary": {"type": "array", "minItems": SUMMARY_LINES, "maxItems": SUMMARY_LINES, "items": {"type": "string"}},
        "models": _ITEMS,
        "open_source": _ITEMS,
        "industry": _ITEMS,
        "trends": {"type": "string"},
        "labs": {"type": "array", "items": {
            "type": "object",
            "properties": {"lab": {"type": "string"}, "text": {"type": "string"},
                           "ref": {"type": ["string", "null"]}},
            "required": ["lab", "text", "ref"],
            "additionalProperties": False,
        }},
    },
    "required": ["summary", "models", "open_source", "industry", "trends", "labs"],
    "additionalProperties": False,
}

BRIEF_PROMPT = """你在为用户写今天的"AI 简报"（过去 24 小时）。只根据下面的素材写，不编造素材里没有的事。
每条素材都有编号 ref（n1、n2…）；引用素材时 ref 只能填素材里给的编号，不要写链接。
{now}

用户的口味（亲口说的偏好、问问过的卡片）：
{taste}

今天已选好的论文（这一节由系统直接列出，你不用写，只在趋势和摘要里可以提到）：
{papers}

网页新闻（Google News 搜索结果，按查询分组；标题末尾是媒体名）：
{news}

写这些部分。每条就一行、一句话（≤ {line} 字），说清是什么、为什么值得知道；素材里多条讲同一件事就合成一条，ref 填最权威的那条来源的编号。
同一件事全文只出现一次：先写进最合适的一节，后面的节（包括实验室覆盖）不再重复；同一个编号不要引用两次。
- models：新模型发布（新模型、新版本、重大能力更新），最多 {n} 条。
- open_source：开源项目（开源模型、权重、工具、代码库），最多 {n} 条。
- industry：行业新闻（融资、上市、合作、政策、产品发布等），最多 {n} 条。
- trends：趋势解读，一段、不超过 3 句（不换行），从今天的新闻和论文里能看出的方向，和用户关注点的关系；素材太少就写一句"今天素材不多"之类的实话。
- labs：实验室覆盖，按这个顺序每家一条，lab 原样照抄：{labs}。text 一句话写这家今天有没有新发布 / 论文 / 重要动态，ref 给最能说明的一条素材的编号；
  这家的事已经写在上面某节（含论文）里的，text 只写"见上"（英文 See above）、ref 给 null；没有动态写"今天没有新发布"之类、ref 给 null。
  注意同名误伤（比如 Seed 可能是种子轮融资），不是这家实验室的事不算。
- summary：正好 3 行要点，卡片上只显示这 3 行，每行一句、≤ 40 字，挑今天最重要的 3 件事。
没有合适内容的节给空数组（系统会写"今天没有"），不要硬凑。
{rules}
只输出符合 schema 的 JSON。"""


@dataclass
class Brief:
    card: dict
    papers: int
    news: int
    failed: list[str]
    paper_health: tuple[str, str]    # (health, detail) of the paper material, for the feed-papers source


def _items(items: list[dict], cites: dict[str, Citation]) -> list[str]:
    return [f"- {i['text'].strip()} {_link(cites[i['ref']].name, cites[i['ref']].url)}" for i in items]


def render_paper(lang: str, p: dict) -> str:
    """One paper line; feed.BRIEF_PAPER_LINE parses it back for the weekly papers report."""
    return say(lang, "- [{title}]({link})：{what} 和你有关：{why}", title=p["title"], link=p["link"],
               what=p["what"], why=p["why"])


def _cited(result: dict) -> list[str]:
    """Every ref the brief cites, in order."""
    return ([i["ref"] for s in NEWS_SECTIONS for i in result[s]]
            + [l["ref"] for l in result["labs"] if l["ref"] is not None])


def _validate_brief(result: dict, labs: list[str], allowed: set[str]) -> None:
    where = "claude brief"
    require_fields(result, tuple(BRIEF_SCHEMA["required"]), where)
    if len(result["summary"]) != SUMMARY_LINES or any(not s.strip() for s in result["summary"]):
        raise ValidationError(f"{where}: summary must be {SUMMARY_LINES} non-empty lines, got {result['summary']}")
    require_nonempty_str(result, "trends", where)
    for section in NEWS_SECTIONS:
        for i, item in enumerate(result[section]):
            require_nonempty_str(item, "text", f"{where} {section}[{i}]")
        _check_refs([i["ref"] for i in result[section]], allowed, f"{where} {section}")
    if [l["lab"] for l in result["labs"]] != labs:
        raise ValidationError(f"{where}: labs {[l['lab'] for l in result['labs']]} != {labs}")
    for i, l in enumerate(result["labs"]):
        require_nonempty_str(l, "text", f"{where} labs[{i}]")
    _check_refs([l["ref"] for l in result["labs"] if l["ref"] is not None], allowed, f"{where} labs")
    cited = _cited(result)
    twice = sorted({r for r in cited if cited.count(r) > 1})
    if twice:
        raise ValidationError(f"{where}: refs cited more than once (same event twice): {twice}")


def _brief_body(lang: str, result: dict, papers: list[dict], cites: dict[str, Citation]) -> str:
    none = say(lang, "今天没有")

    def section(heading: str, lines: list[str]) -> str:
        return f"## {say(lang, heading)}\n\n" + ("\n".join(lines) if lines else none)

    labs = [f"- **{l['lab']}**：{l['text'].strip()}"
            + ("" if l["ref"] is None else " " + _link(cites[l["ref"]].name, cites[l["ref"]].url))
            for l in result["labs"]]
    return "\n\n".join([
        section("新模型发布", _items(result["models"], cites)),
        section("重要论文", [render_paper(lang, p) for p in papers]),
        section("开源项目", _items(result["open_source"], cites)),
        section("行业新闻", _items(result["industry"], cites)),
        section("趋势解读", [result["trends"].strip()]),
        section("实验室覆盖", labs),
    ])


def write_brief(hub: Hub, labs: list[str], lang: str) -> Brief:
    """Gather material and write today's brief card (not posted)."""
    since = datetime.now(UTC) - BRIEF_WINDOW
    failed: list[str] = []
    try:
        papers, why_none = feed.pick_papers(hub, lang)
    except Exception as e:
        log.exception("paper picks failed")
        papers = []
        failed.append(f"{say(lang, '论文')}: {type(e).__name__}: {e}")
        paper_health = ("error", f"{type(e).__name__}: {e}"[:PAPER_DETAIL_CHARS])
    else:
        if why_none is None:
            paper_health = ("ok", say(lang, "简报选了 {n} 篇论文", n=len(papers)))
        else:
            log.info("brief: no papers: %s", why_none)
            paper_health = ("warn", why_none)
    news_queries = {q: q for q in BRIEF_NEWS_QUERIES} | {lab: _lab_news_query(lab) for lab in labs}
    m = _gather(lang, news_queries, since)
    failed += m.failed

    result = claude.ask_json(BRIEF_PROMPT.format(
        now=now_context(), taste=dump(taste.light(hub)), n=SECTION_ITEMS, line=LINE_CHARS, labs="、".join(labs),
        papers=dump([{k: p[k] for k in ("title", "what")} for p in papers]),
        news=dump(m.shown()), rules=user_text_rules(lang),
    ), BRIEF_SCHEMA)
    _validate_brief(result, labs, set(m.refs))

    body = _brief_body(lang, result, papers, m.cite(lang, _cited(result)))
    read_chars = len(LINK_TARGET.sub("]", body))
    if read_chars > BODY_BUDGET_CHARS:
        raise ValidationError(f"brief body has {read_chars} chars of text, budget {BODY_BUDGET_CHARS}")
    if failed:
        body += "\n\n> " + say(lang, "这些来源今天没取到：{sources}", sources=join(lang, failed))
    if len(body) > BODY_MAX_CHARS:
        raise ValidationError(f"brief body is {len(body)} chars, max {BODY_MAX_CHARS}")
    today = datetime.now(ZoneInfo(TIMEZONE)).date()
    card = {
        "origin": "brief",
        "kind": "brief",
        "project_id": None,
        "title": say(lang, "今日 AI 简报 · {date}", date=short_date(today)),
        "summary": "\n".join(s.strip() for s in result["summary"])[:SUMMARY_MAX_CHARS],
        "body": body,
        "link": None,
        "dedupe_key": today.isoformat(),
    }
    return Brief(card=card, papers=len(papers), news=sum(len(result[s]) for s in NEWS_SECTIONS),
                 failed=failed, paper_health=paper_health)


def _posted_today(hub: Hub) -> bool:
    today = datetime.now(ZoneInfo(TIMEZONE)).date().isoformat()
    return any(c["kind"] == "brief" and c["dedupe_key"] == today
               for s in CARD_STATUSES for c in hub.list_cards(CARD_SCAN_LIMIT, s))


def feed_brief(hub: Hub, job: dict, lang: str) -> None:
    subscriptions.run(hub, "brief", lang, _feed_brief)


def _feed_brief(hub: Hub, sub: dict, lang: str) -> tuple[str, str]:
    if _posted_today(hub):
        return "ok", say(lang, "今天的简报已经发过")
    labs = subscriptions.by_kind(hub, "watch")["config"]["labs"]
    brief = write_brief(hub, labs, lang)
    hub.post_card(brief.card)
    # After the card, so a status failure cannot lose the report.
    health.report(hub, health.FEED_PAPERS, *brief.paper_health)
    result = say(lang, "简报写好：论文 {papers} 篇、新闻 {news} 条", papers=brief.papers, news=brief.news)
    if brief.failed:
        return "warn", result + say(lang, "；没取到：{sources}", sources=join(lang, brief.failed))
    return "ok", result


# ---------------------------------------------------------------- feed_watch

WATCH_SCHEMA = {
    "type": "object",
    "properties": {"alerts": {"type": "array", "items": {
        "type": "object",
        "properties": {
            "lab": {"type": "string"},
            "event": {"type": "string"},
            "status": {"type": "string", "enum": list(STATUSES)},
            "title": {"type": "string"},
            "summary": {"type": "array", "minItems": SUMMARY_LINES, "maxItems": SUMMARY_LINES,
                        "items": {"type": "string"}},
            "details": {"type": "string"},
            "refs": {"type": "array", "minItems": 1, "items": {"type": "string"}},
        },
        "required": ["lab", "event", "status", "title", "summary", "details", "refs"],
        "additionalProperties": False,
    }}},
    "required": ["alerts"],
    "additionalProperties": False,
}

WATCH_PROMPT = """你在盯这几家 AI 实验室的新动态：{labs}。下面是 {since} 以来的素材。只根据素材判断，不编造。
每条素材都有编号 ref（n1、n2…）；refs 只能填素材里给的编号，不要写链接。
{now}

网页新闻（Google News 搜索结果，按实验室分组；标题末尾是媒体名）：
{news}

已经报过的事件（key = 实验室:事件简称，以 {confirmed} 结尾的是按"确认"报过的，其余是按"传闻"报过的）：
{reported}

报这些实质消息：新模型 / 新版本发布、开源（权重、代码）、重要技术报告或论文、争议或安全事件，
也包括关于这些的传闻、泄露、曝光（如 API 后台出现新模型名、测试域名、内部消息）。
股价、融资、泛泛评测、教程、个人使用体验、旧闻重提都不算。注意同名误伤（比如 Seed 可能是种子轮融资），不是这家实验室的事不算。
没有实质消息就给空数组——宁缺毋滥，不打扰用户。每个事件一条：
- lab：原样照抄上面名单里的实验室名。
- event：事件简称，稳定、短（如"DeepSeek-V4 发布"），不带"传闻""确认"字样；同一件事以后也这么叫。
- status：rumor（传闻、泄露、曝光，未经官方或多家可靠媒体证实）或 confirmed（官方发布，或多家可靠媒体证实）。
  已按传闻报过的事件，只有现在确认了才再报一次：event 和报过的写得一模一样、status=confirmed；已按确认报过的不再报。
- title：一句话标题（不用写【传闻】【确认】，系统会加）。
- summary：正好 3 行要点，每行一句、≤ 40 字；第一行说明消息来源和可信度（如"官方博客发布"、"多家媒体援引知情人士，未证实"、"有用户在测试域名发现，未证实"）。
- details：细节，一段 2–5 句（不换行）：发布了什么、关键数字 / 能力、和之前的区别、为什么重要；素材里没有的不写。
- refs：素材里最能说明这件事的 1–3 条的编号。
{rules}
只输出符合 schema 的 JSON。"""


@dataclass
class Alert:
    key: str
    card: dict


@dataclass
class Watch:
    alerts: list[Alert]
    failed: list[str]


def _load_state() -> dict | None:
    """None before the first successful run."""
    if not WATCH_STATE.exists():
        return None
    return json.loads(WATCH_STATE.read_text())


def _save_state(state: dict) -> None:
    STATE_DIR.mkdir(exist_ok=True)
    WATCH_STATE.write_text(json.dumps(state, ensure_ascii=False, indent=2))


def _validate_alerts(result: dict, labs: list[str], allowed: set[str]) -> list[dict]:
    require_fields(result, ("alerts",), "claude watch")
    for i, a in enumerate(result["alerts"]):
        where = f"claude watch alerts[{i}]"
        require_fields(a, tuple(WATCH_SCHEMA["properties"]["alerts"]["items"]["required"]), where)
        if a["status"] not in STATUSES:
            raise ValidationError(f"{where}: status {a['status']!r} not in {STATUSES}")
        if a["lab"] not in labs:
            raise ValidationError(f"{where}: lab {a['lab']!r} not in {labs}")
        for f in ("event", "title", "details"):
            require_nonempty_str(a, f, where)
        if len(a["summary"]) != SUMMARY_LINES or any(not s.strip() for s in a["summary"]):
            raise ValidationError(f"{where}: summary must be {SUMMARY_LINES} non-empty lines, got {a['summary']}")
        _check_refs(a["refs"], allowed, where)
    return result["alerts"]


def find_alerts(hub: Hub, labs: list[str], since: datetime, reported: list[dict], lang: str) -> Watch:
    """Substantive lab events since `since` that are not in `reported`, as alert cards (not posted)."""
    m = _gather(lang, {lab: _lab_news_query(lab) for lab in labs}, since)
    result = claude.ask_json(WATCH_PROMPT.format(
        labs="、".join(labs), since=since.astimezone(ZoneInfo(TIMEZONE)).isoformat(timespec="minutes"),
        now=now_context(), news=dump(m.shown()),
        reported=dump([{k: r[k] for k in ("key", "title")} for r in reported]), confirmed=CONFIRMED_SUFFIX,
        rules=user_text_rules(lang),
    ), WATCH_SCHEMA)
    seen = {r["key"] for r in reported}
    kept = []
    for a in _validate_alerts(result, labs, set(m.refs)):
        base = f"{a['lab']}:{a['event'].strip()}"
        key = base + CONFIRMED_SUFFIX if a["status"] == "confirmed" else base
        # A rumor after its confirmation is old news; a confirmation after its rumor is reported again.
        if key in seen or base + CONFIRMED_SUFFIX in seen:
            continue
        seen.add(key)
        kept.append((key, a))
    cites = m.cite(lang, [r for _, a in kept for r in a["refs"]])
    alerts = []
    for key, a in kept:
        alerts.append(Alert(key=key, card={
            "origin": f"watch:{a['lab']}",
            "kind": "alert",
            "project_id": None,
            "title": say(lang, TITLE_PREFIX[a["status"]]) + a["title"].strip(),
            "summary": "\n".join(s.strip() for s in a["summary"])[:SUMMARY_MAX_CHARS],
            "body": alert_body(lang, a["details"], [cites[r] for r in a["refs"]]),
            "link": cites[a["refs"][0]].url,
            "dedupe_key": key,
        }))
    return Watch(alerts=alerts, failed=m.failed)


def alert_body(lang: str, details: str, cites: list[Citation]) -> str:
    """Details, then one "出处：标题" link per source (api.md 补充 5)."""
    links = "\n".join("- " + _link(say(lang, "{source}：{title}", source=c.name, title=_short(c.title)), c.url)
                      for c in cites)
    return f"{details.strip()}\n\n## {say(lang, '相关链接')}\n\n{links}"


def feed_watch(hub: Hub, job: dict, lang: str) -> None:
    subscriptions.run(hub, "watch", lang, _feed_watch)


def _feed_watch(hub: Hub, sub: dict, lang: str) -> tuple[str, str]:
    started = datetime.now(UTC)
    state = _load_state()
    if state is None:  # first run: the last `every_hours` (api.md)
        state = {"last_success_at": (started - timedelta(hours=sub["config"]["every_hours"])).isoformat(),
                 "reported": []}
    watch = find_alerts(hub, sub["config"]["labs"], datetime.fromisoformat(state["last_success_at"]),
                        state["reported"], lang)
    for alert in watch.alerts:
        hub.post_card(alert.card)
        state["reported"].append({"key": alert.key, "title": alert.card["title"], "at": started.isoformat()})
    state["reported"] = state["reported"][-REPORTED_KEEP:]
    state["last_success_at"] = started.isoformat()
    _save_state(state)

    if watch.alerts:
        result = say(lang, "新动态 {n} 条：{titles}", n=len(watch.alerts),
                     titles=join(lang, [a.card["title"] for a in watch.alerts]))
    else:
        result = say(lang, "没有新动态")
    if watch.failed:
        return "warn", result + say(lang, "；没取到：{sources}", sources=join(lang, watch.failed))
    return "ok", result
