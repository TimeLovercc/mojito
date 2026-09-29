"""weekly_summary: this week's records, commits and item changes -> one chat message."""
from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

from mojito_worker import claude, local_facts
from mojito_worker.config import TIMEZONE
from mojito_worker.hub import Hub
from mojito_worker.i18n import say
from mojito_worker.prompting import user_text_rules, dump, now_context
from mojito_worker.validate import require_fields, require_nonempty_str

WEEK = timedelta(days=7)
PAGE = 100

SCHEMA = {
    "type": "object",
    "properties": {"summary": {"type": "string"}},
    "required": ["summary"],
    "additionalProperties": False,
}

PROMPT = """你在为用户写 mojito 的每周总结，会作为一条对话消息推送到手机。
{now}

本周（过去 7 天）的全部记录（倒序，含系统日志、笔记、对话、拍板）：
{records}

本周有更新的事项：
{items}

本周各本地仓库的提交：
{commits}

当前 active 计划（没有则为 null）：
{plan}

使用指标（GET /metrics，用户时区的日期；opens = 当天打开 app 次数，evening_asked / evening_replied = 晚上提问 / 当晚回复）：
本周：{metrics}
上周：{metrics_prev}

要求：简洁。开头先写使用情况：本周每天打开次数、晚间提问回了几次（x/y），和上周比是多了还是少了——这是检验 mojito 有没有用的两个数，照实写，不评价用户。
然后按"推进了什么 / 卡住或拖着的 / 下周最该做的 1-3 件"组织；每点尽量带出处（事项名、仓库、记录日期）；
推断的内容说明是推断；没数据的部分直接说没有，不要编。
{rules}
只输出符合 schema 的 JSON。"""


def _week_records(hub: Hub, since: datetime) -> list[dict]:
    records, before = [], None
    while True:
        page = hub.list_records(PAGE, before)
        records.extend(r for r in page if datetime.fromisoformat(r["at"]) >= since)
        if len(page) < PAGE or datetime.fromisoformat(page[-1]["at"]) < since:
            return records
        before = page[-1]["id"]


def _active_plan(hub: Hub) -> dict | None:
    """Between two periods there may be no active plan; that is a normal state here."""
    active = [p for p in hub.list_plans() if p["status"] == "active"]
    return hub.get_plan(active[0]["id"]) if active else None


def weekly_summary(hub: Hub, job: dict, lang: str) -> None:
    since = datetime.now(UTC) - WEEK
    today = datetime.now(ZoneInfo(TIMEZONE)).date()
    items = [i for i in hub.list_items() if datetime.fromisoformat(i["updated_at"]) >= since]
    repos = local_facts.find_repos()
    prompt = PROMPT.format(
        now=now_context(),
        records=dump([{k: r[k] for k in ("at", "author", "source", "kind", "item_id", "title", "body")} for r in _week_records(hub, since)]),
        items=dump(items),
        commits=dump(local_facts.recent_commits(repos, WEEK.days)),
        plan=dump(_active_plan(hub)),
        metrics=dump(hub.metrics((today - timedelta(days=6)).isoformat(), today.isoformat())),
        metrics_prev=dump(hub.metrics((today - timedelta(days=13)).isoformat(), (today - timedelta(days=7)).isoformat())),
        rules=user_text_rules(lang),
    )
    result = claude.ask_json(prompt, SCHEMA)
    require_fields(result, ("summary",), "claude weekly")
    require_nonempty_str(result, "summary", "claude weekly")
    hub.post_event(kind="chat", tier="digest", item_id=None, project_id=None, title=say(lang, "本周总结"), body=result["summary"].strip(), evidence="inferred")
