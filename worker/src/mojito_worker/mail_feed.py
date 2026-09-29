"""feed_mail (api.md 每日邮件): one "今日邮件" card from the last 24 hours of Gmail (read-only).

Only headers and Gmail's snippet go to Claude, locally; the hub gets just the card (one line per mail with
a Gmail link). Mail bodies never leave the Mac.
"""
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from mojito_worker import claude, subscriptions, taste
from mojito_worker.config import TIMEZONE
from mojito_worker.gmail import Gmail
from mojito_worker.hub import Hub
from mojito_worker.i18n import say
from mojito_worker.prompting import user_text_rules, dump, now_context
from mojito_worker.redact import redact
from mojito_worker.validate import ValidationError, require_fields, require_nonempty_str

WINDOW = timedelta(hours=24)
SCAN_MAX = 150
MAX_PICKS = 8
SUBJECT_CHARS = 30
SUMMARY_MAX_CHARS = 800
GMAIL_LINK = "https://mail.google.com/mail/u/0/#inbox/{id}"

PICK_SCHEMA = {
    "type": "object",
    "properties": {
        "picks": {
            "type": "array",
            "maxItems": MAX_PICKS,
            "items": {
                "type": "object",
                "properties": {
                    "id": {"type": "string"},
                    "sender": {"type": "string"},
                    "gist": {"type": "string"},
                    "why": {"type": "string"},
                },
                "required": ["id", "sender", "gist", "why"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["picks"],
    "additionalProperties": False,
}

PROMPT = """你在为用户挑过去 24 小时收到的邮件里值得看的（最多 {max} 封），做成一张"今日邮件"卡片。
{now}

值得看：需要用户回复或处理的（同事、合作者、家人朋友、银行、医院、政府机构、账单到期等真人或重要机构的来信）、有截止时间的、和进行中项目相关的。
不值得看：营销、订阅简报、社交网络通知、自动回执、验证码（除非用户可能在等）。宁缺毋滥，都不值得就给空数组。

用户的口味和进行中的项目（供判断相关性）：
{taste}
{projects}

邮件（id、发件人、主题、日期、标签、摘要片段）：
{mails}

每封：
- sender：发件人的简短称呼（人名或机构名，不要邮箱地址）。
- gist：一句话说这封信讲什么，≤ 20 字。
- why：为什么要看（要回 / 有截止 / 和哪个项目相关），≤ 15 字。
按重要程度排序，最重要的在前。{rules}
只输出符合 schema 的 JSON。"""


def feed_mail(hub: Hub, job: dict, lang: str) -> None:
    subscriptions.run(hub, "mail", lang, _feed_mail)


def _feed_mail(hub: Hub, sub: dict, lang: str) -> tuple[str, str]:
    now = datetime.now(ZoneInfo(TIMEZONE))
    mails = Gmail().received_since(int((now - WINDOW).timestamp()), SCAN_MAX)
    by_id = {m["id"]: m for m in mails}
    picks = []
    if mails:
        result = claude.ask_json(PROMPT.format(
            max=MAX_PICKS, now=now_context(), rules=user_text_rules(lang),
            taste=dump(taste.light(hub)),
            projects=dump([{k: p[k] for k in ("title", "summary")} for p in hub.list_projects("active")]),
            mails=dump([{"id": m["id"], "from": m["from"], "subject": m["subject"], "date": m["date"],
                         "labels": m["labels"], "snippet": redact(m["snippet"])} for m in mails]),
        ), PICK_SCHEMA)
        picks = _validated(result, by_id)

    lines = []
    for p in picks:
        subject = by_id[p["id"]]["subject"]
        subject = say(lang, "（无主题）") if subject is None else subject
        line = say(lang, "{sender} · {subject} —— {gist}（{why}）[打开]({link})", sender=p["sender"].strip(),
                   subject=subject[:SUBJECT_CHARS], gist=p["gist"].strip(), why=p["why"].strip(),
                   link=GMAIL_LINK.format(id=p["id"]))
        if len("\n".join([*lines, line])) > SUMMARY_MAX_CHARS:
            break  # picks are ordered by importance; the rest would not fit the card
        lines.append(line)

    today = now.date().isoformat()
    if lines:
        title, summary = say(lang, "今日邮件：{n} 封值得看", n=len(lines)), "\n".join(lines)
    else:
        title, summary = say(lang, "今天没有要紧邮件"), say(lang, "过去 24 小时收到 {n} 封，没有需要你看的。", n=len(mails))
    card = hub.post_card({
        "origin": "gmail",
        "kind": "mail",
        "project_id": None,
        "title": title,
        "summary": summary,
        "link": None,
        "dedupe_key": today,
    })
    if card is None:
        return "ok", say(lang, "今天的邮件卡已经发过（收到 {n} 封）", n=len(mails))
    return "ok", say(lang, "收到 {n} 封，{m} 封值得看", n=len(mails), m=len(lines))


def _validated(result: dict, by_id: dict[str, dict]) -> list[dict]:
    require_fields(result, ("picks",), "claude mail picks")
    for i, p in enumerate(result["picks"]):
        where = f"claude mail picks[{i}]"
        require_fields(p, ("id", "sender", "gist", "why"), where)
        for f in ("sender", "gist", "why"):
            require_nonempty_str(p, f, where)
        if p["id"] not in by_id:
            raise ValidationError(f"{where}: unknown message id {p['id']!r}")
    return result["picks"]
