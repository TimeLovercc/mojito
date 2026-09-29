"""Paper feed (api.md 大批改进 §1).

feed_papers (daily): candidates from
  - arXiv MOJITO_ARXIV_CATEGORIES, the latest submission day (owner's timezone) that has papers (the API only
    lists announced papers, so "yesterday" is often still empty; look back up to LOOKBACK_DAYS);
  - Hugging Face daily papers;
  - followed authors (Zotero, when MOJITO_ZOTERO_DB is set): every candidate is matched against all followed authors, and the most
    frequent ones also get a direct arXiv author query over the last AUTHOR_DAYS days;
deduplicated by arXiv id and against cards already published. Claude then shortlists by title against the
taste profile (<= SHORTLIST_MAX) and picks MIN_CARDS–MAX_CARDS from the abstracts.

feed_weekly (Sundays): one report card with the week's best 3 papers and trends, from this week's cards.
"""
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from mojito_worker import arxiv, claude, health, hf, subscriptions, taste
from mojito_worker.config import ARXIV_CATEGORIES, TIMEZONE
from mojito_worker.hub import Hub
from mojito_worker.i18n import say
from mojito_worker.prompting import user_text_rules, dump, now_context, short_date
from mojito_worker.validate import ValidationError, require_fields, require_nonempty_str

CATEGORIES = ARXIV_CATEGORIES
LOOKBACK_DAYS = 4
AUTHOR_DAYS = 3
AUTHOR_BATCH = 25
CARD_STATUSES = ("new", "saved", "dismissed")
CARD_SCAN_LIMIT = 200
SHORTLIST_MAX = 40
MIN_CARDS = 5
MAX_CARDS = 10
SUMMARY_MAX_CHARS = 800
ABSTRACT_CHARS = 1500

SHORTLIST_SCHEMA = {
    "type": "object",
    "properties": {"ids": {"type": "array", "maxItems": SHORTLIST_MAX, "items": {"type": "string"}}},
    "required": ["ids"],
    "additionalProperties": False,
}

PICK_SCHEMA = {
    "type": "object",
    "properties": {
        "picks": {
            "type": "array",
            "maxItems": MAX_CARDS,
            "items": {
                "type": "object",
                "properties": {
                    "id": {"type": "string"},
                    "what": {"type": "string"},
                    "why": {"type": "string"},
                    "project_id": {"type": ["string", "null"]},
                    "followed_author": {"type": ["string", "null"]},
                },
                "required": ["id", "what", "why", "project_id", "followed_author"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["picks"],
    "additionalProperties": False,
}

CONTEXT = """你在为用户挑今天值得读的论文（候选 {n} 篇：arXiv {day} 提交的 {cats}、Hugging Face 每日论文、关注作者的新论文）。
{now}

用户的口味档案。最重要的依据是用户亲口说的偏好（taste_notes）和用户在信息流里"问问"过的卡片（cards_asked_about，说明真感兴趣）；
其次是 Zotero 里最近收藏的论文、进行中项目、关注作者（没接 Zotero 时这两项为空）；cards_saved / cards_dismissed 是旧数据，仅供参考：
{profile}
"""

SHORTLIST = """
候选（id | 来源 | 标题 | 和关注作者同名的作者，可能只是同名）：
{titles}

第一轮：只看标题和口味档案，选出最多 {max} 篇可能值得读的（和项目直接相关、方法可借鉴、竞争工作、关注作者的重要新作）。
用户亲口说的偏好和问过的卡片优先。宁缺毋滥。
只输出符合 schema 的 JSON。"""

PICK = """
第一轮候选（含摘要）：
{papers}

第二轮：精选 {min}–{max} 篇（真不够相关时可以少于 {min}）。每篇：
- what：一句话说这篇做了什么。
- why：为什么用户会感兴趣——对上口味档案里的哪一点（项目、偏好、关注作者），1–2 句，不夸大。
- project_id：最相关的进行中项目 id；只是泛泛相关就 null。
- followed_author：候选的 followed_authors 只是名字和关注作者相同，常见姓名（如 A. Author 这类常见名）很可能是另一个人。
  只有这篇的题目 / 摘要和 followed_author_evidence 里此人在用户 Zotero 中论文的主题相近，或者有共同合作者（shared_coauthors），
  才算关注作者的新作：填那个名字（和 followed_authors 里的写法一致），并在 why 里说出他和依据（相近的哪篇收藏或共同合作者）。否则填 null，why 里也不要说"你关注的某某"。
what、why 用户会看到：用项目名称指代项目，不写 id。{rules}
只输出符合 schema 的 JSON。"""


def _day_window(day: date) -> tuple[datetime, datetime]:
    start = datetime.combine(day, time.min, ZoneInfo(TIMEZONE))
    return start.astimezone(ZoneInfo("UTC")), (start + timedelta(days=1)).astimezone(ZoneInfo("UTC"))


def _latest_arxiv_day() -> tuple[date, list[dict]] | None:
    yesterday = datetime.now(ZoneInfo(TIMEZONE)).date() - timedelta(days=1)
    for back in range(LOOKBACK_DAYS):
        day = yesterday - timedelta(days=back)
        papers = arxiv.submitted_between(CATEGORIES, *_day_window(day))
        if papers:
            return day, papers
    return None


def _published_keys(hub: Hub) -> set[str]:
    return {c["dedupe_key"] for s in CARD_STATUSES for c in hub.list_cards(CARD_SCAN_LIMIT, s) if c["kind"] == "paper"}


def _followed_in(paper: dict, followed: set[str]) -> list[str]:
    return [a for a in paper["authors"] if a.lower() in followed]


def _candidates(hub: Hub, t: taste.Taste, lang: str) -> tuple[str, dict[str, dict]]:
    """arXiv id -> paper with `origin`; the label of the arXiv day used."""
    published = _published_keys(hub)
    pool: dict[str, dict] = {}

    found = _latest_arxiv_day()
    day_label = say(lang, "（近几天没有新论文）")
    if found is not None:
        day, papers = found
        day_label = short_date(day)
        # The day was handled by an earlier run (weekends re-find the same day): skip its papers.
        if not {p["id"] for p in papers} & published:
            for p in papers:
                pool[p["id"]] = {**p, "origin": "arxiv"}

    for p in hf.daily_papers():
        pool[p["id"]] = {**p, "origin": "hf-daily"}

    now = datetime.now(ZoneInfo("UTC"))
    for p in arxiv.by_authors(t.query_authors, now - timedelta(days=AUTHOR_DAYS), now, AUTHOR_BATCH):
        pool.setdefault(p["id"], {**p, "origin": "arxiv"})

    # Name matches only; whether a match is really the followed author is judged per pick (namesakes).
    for p in pool.values():
        p["followed_authors"] = _followed_in(p, t.followed)
    return day_label, {i: p for i, p in pool.items() if i not in published}


def _author_evidence(paper: dict, evidence: dict[str, dict]) -> dict[str, dict]:
    """Per name-matched followed author: their Zotero titles and the paper's authors who are also their
    Zotero co-authors."""
    return {a: {"zotero_titles": evidence[a.lower()]["titles"],
                "shared_coauthors": [o for o in paper["authors"] if o.lower() in evidence[a.lower()]["coauthors"]]}
            for a in paper["followed_authors"]}


def feed_papers(hub: Hub, job: dict, lang: str) -> None:
    subscriptions.run(hub, "papers", lang, _feed_papers_with_health)


def _feed_papers_with_health(hub: Hub, sub: dict, lang: str) -> tuple[str, str]:
    """Also reports `feed-papers` result health for the system page (0 cards -> warn, failure -> error)."""
    try:
        posted, why_none = _feed_papers(hub, lang)
    except Exception as e:
        health.report_error(hub, health.FEED_PAPERS, e)
        raise
    if posted:
        result = ("ok", say(lang, "发了 {n} 张卡片", n=posted))
    else:
        result = ("warn", why_none)
    health.report(hub, health.FEED_PAPERS, *result)
    return result


def _feed_papers(hub: Hub, lang: str) -> tuple[int, str | None]:
    """(cards posted, why none were posted)."""
    t = taste.build(hub)
    day_label, pool = _candidates(hub, t, lang)
    if not pool:
        return 0, say(lang, "抓到 0 篇新论文（arXiv、HF 每日论文、关注作者都没有没推过的）")
    project_ids = {p["id"] for p in t.profile["projects"]}
    context = CONTEXT.format(n=len(pool), day=day_label, cats="/".join(CATEGORIES), now=now_context(),
                             profile=dump(t.profile))

    titles = "\n".join(f"{p['id']} | {p['origin']} | {p['title']} | {', '.join(p['followed_authors'])}"
                       for p in pool.values())
    shortlist = claude.ask_json(context + SHORTLIST.format(titles=titles, max=SHORTLIST_MAX), SHORTLIST_SCHEMA)
    require_fields(shortlist, ("ids",), "claude shortlist")
    unknown = [i for i in shortlist["ids"] if i not in pool]
    if unknown:
        raise ValidationError(f"claude shortlist: unknown arXiv ids {unknown}")
    if not shortlist["ids"]:
        return 0, say(lang, "抓到 {n} 篇，按标题粗筛后 0 篇", n=len(pool))

    evidence = taste.author_evidence({a.lower() for i in shortlist["ids"] for a in pool[i]["followed_authors"]})
    candidates = [{"id": i, "title": pool[i]["title"], "abstract": pool[i]["abstract"][:ABSTRACT_CHARS],
                   "authors": pool[i]["authors"][:8], "followed_authors": pool[i]["followed_authors"],
                   "followed_author_evidence": _author_evidence(pool[i], evidence)}
                  for i in shortlist["ids"]]
    result = claude.ask_json(context + PICK.format(papers=dump(candidates), min=MIN_CARDS, max=MAX_CARDS,
                                                   rules=user_text_rules(lang)), PICK_SCHEMA)
    require_fields(result, ("picks",), "claude picks")
    for i, pick in enumerate(result["picks"]):
        where = f"claude picks[{i}]"
        require_fields(pick, ("id", "what", "why", "project_id", "followed_author"), where)
        require_nonempty_str(pick, "what", where)
        require_nonempty_str(pick, "why", where)
        if pick["id"] not in shortlist["ids"]:
            raise ValidationError(f"{where}: id {pick['id']!r} not in shortlist")
        if pick["project_id"] is not None and pick["project_id"] not in project_ids:
            raise ValidationError(f"{where}: project_id {pick['project_id']!r} not in {sorted(project_ids)}")
        followed = pool[pick["id"]]["followed_authors"]
        if pick["followed_author"] is not None and pick["followed_author"] not in followed:
            raise ValidationError(f"{where}: followed_author {pick['followed_author']!r} not in {followed}")

    if not result["picks"]:
        return 0, say(lang, "抓到 {n} 篇，粗筛 {m} 篇，读摘要后 0 篇", n=len(pool), m=len(shortlist["ids"]))
    titles_by_project = {p["id"]: p["title"] for p in t.profile["projects"]}
    posted = 0
    for pick in result["picks"]:
        paper = pool[pick["id"]]
        summary = f"{pick['what'].strip()}\n" + say(lang, "为什么你会感兴趣：{why}", why=pick["why"].strip())
        if pick["project_id"] is not None:
            summary += "\n" + say(lang, "相关项目：{project}", project=titles_by_project[pick["project_id"]])
        origin = paper["origin"] if pick["followed_author"] is None else f"author:{pick['followed_author']}"
        card = hub.post_card({
            "origin": origin,
            "kind": "paper",
            "project_id": pick["project_id"],
            "title": paper["title"],
            "summary": summary[:SUMMARY_MAX_CHARS],
            "link": paper["link"],
            "dedupe_key": paper["id"],
        })
        posted += card is not None
    return posted, say(lang, "精选的论文都已经推过") if not posted else None


# ---------------------------------------------------------------- weekly

WEEK = timedelta(days=7)
WEEKLY_TOP = 3

WEEKLY_SCHEMA = {
    "type": "object",
    "properties": {
        "top": {
            "type": "array",
            "maxItems": WEEKLY_TOP,
            "items": {
                "type": "object",
                "properties": {"card_id": {"type": "string"}, "why": {"type": "string"}},
                "required": ["card_id", "why"],
                "additionalProperties": False,
            },
        },
        "trends": {"type": "string"},
    },
    "required": ["top", "trends"],
    "additionalProperties": False,
}

WEEKLY_PROMPT = """你在为用户写"本周论文"：从这周信息流推过的论文卡片里挑最值得读的 {top} 篇，并总结趋势。
{now}

用户的口味档案：
{profile}

本周推过的论文卡片：
{cards}

- top：最值得读的 {top} 篇（用户问过、合口味笔记的优先），why 一句话说为什么值得读。
- trends：2–3 句，这周这些论文里能看出的方向或趋势，和用户项目的关系。
{rules}
只输出符合 schema 的 JSON。"""


def feed_weekly(hub: Hub, job: dict, lang: str) -> None:
    since = datetime.now(ZoneInfo("UTC")) - WEEK
    cards = [c for s in CARD_STATUSES for c in hub.list_cards(CARD_SCAN_LIMIT, s)
             if c["kind"] == "paper" and datetime.fromisoformat(c["at"]) >= since]
    if not cards:
        return
    by_id = {c["id"]: c for c in cards}
    t = taste.build(hub)
    result = claude.ask_json(WEEKLY_PROMPT.format(
        top=WEEKLY_TOP, now=now_context(), profile=dump(t.profile), rules=user_text_rules(lang),
        cards=dump([{k: c[k] for k in ("id", "status", "title", "summary", "link")} for c in cards]),
    ), WEEKLY_SCHEMA)
    require_fields(result, ("top", "trends"), "claude weekly papers")
    require_nonempty_str(result, "trends", "claude weekly papers")
    for i, pick in enumerate(result["top"]):
        require_nonempty_str(pick, "why", f"claude weekly papers top[{i}]")
        if pick["card_id"] not in by_id:
            raise ValidationError(f"claude weekly papers top[{i}]: unknown card {pick['card_id']!r}")

    today = datetime.now(ZoneInfo(TIMEZONE)).date()
    lines = [f"{n}. {by_id[p['card_id']]['title']}：{p['why'].strip()}" for n, p in enumerate(result["top"], start=1)]
    summary = "\n".join(lines) + "\n" + say(lang, "趋势：{trends}", trends=result["trends"].strip())
    hub.post_card({
        "origin": "weekly",
        "kind": "report",
        "project_id": None,
        "title": say(lang, "本周论文（{start}–{end}）", start=short_date(today - timedelta(days=6)), end=short_date(today)),
        "summary": summary[:SUMMARY_MAX_CHARS],
        "link": None,
        "dedupe_key": f"weekly-{today.isoformat()}",
    })
