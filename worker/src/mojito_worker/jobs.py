from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from mojito_worker import claude, projects
from mojito_worker.config import TIMEZONE
from mojito_worker.hub import Hub, writable_item_fields
from mojito_worker.i18n import say
from mojito_worker.prompting import user_text_rules, dump, now_context, short_time
from mojito_worker.validate import (
    ValidationError,
    require_aware_datetime_or_null,
    require_enum,
    require_fields,
    require_nonempty_str,
)

CATEGORIES = ("research", "life")
OWNERS = ("auto", "me", "auto_then_me")
IN_PROGRESS_STATUSES = ("active", "waiting_you", "scheduled")
RECENT_RECORDS_LIMIT = 50
CALENDAR_DAYS = 7
CHAT_CONTEXT = 30
TITLE_CHARS = 40
ITEM_RECORDS_LIMIT = 10


# ---------------------------------------------------------------- process_note

ITEM_DRAFT_FIELDS = ("title", "category", "next_step", "next_at", "owner", "done_definition", "goal_id")

ITEM_DRAFT_SCHEMA = {
    "type": "object",
    "properties": {
        "title": {"type": "string"},
        "category": {"type": "string", "enum": list(CATEGORIES)},
        "next_step": {"type": "string"},
        "next_at": {"type": ["string", "null"], "description": "ISO-8601 datetime with timezone offset, or null"},
        "owner": {"type": "string", "enum": list(OWNERS)},
        "done_definition": {"type": "string"},
        "goal_id": {"type": ["string", "null"]},
    },
    "required": list(ITEM_DRAFT_FIELDS),
    "additionalProperties": False,
}

NOTE_KINDS = ("task", "note", "unclear")

NOTE_SCHEMA = {
    "type": "object",
    "properties": {
        "kind": {"type": "string", "enum": list(NOTE_KINDS)},
        "item": {"anyOf": [{
            **ITEM_DRAFT_SCHEMA,
            "properties": {**ITEM_DRAFT_SCHEMA["properties"], "project_id": {"type": ["string", "null"]}},
            "required": [*ITEM_DRAFT_SCHEMA["required"], "project_id"],
        }, {"type": "null"}]},
        "project_id": {"type": ["string", "null"]},
        "question": {"type": ["string", "null"]},
    },
    "required": ["kind", "item", "project_id", "question"],
    "additionalProperties": False,
}

NOTE_PROMPT = """用户在 mojito 里写了一条笔记，你来整理它（三选一）。
{now}

1. kind=task：这是一件要办的事 → item 给完整事项（会直接记成进行中的事项，不用用户再确认），project_id 与 question 给 null。
   事项字段：
   - title：简短、具体的标题。
   - category：research（工作、研究、论文、实验）或 life（生活、账单、预约、各种手续等）。
   - next_step：今天或近期能做的一小步，一句话，能直接动手。
   - next_at：ISO-8601 带用户时区的偏移（和上面"现在"里的偏移一致）；看不出时间就给一个合理的近期时间；确实没法安排才 null。
   - owner：auto（机器能自己做完）、me（需要用户做）、auto_then_me（机器先准备，最后用户来）。
   - done_definition：什么算做完；最后一步需要用户本人做的（付款、签约、提交、发送、确认等）必须写成"你做了 X"。
   - goal_id：从目标里选最相关的，都不相关就 null。
   - project_id：从进行中的项目里选最相关的，都不相关就 null。
2. kind=note：这是想法、记录或观察，不是要办的事 → project_id 给最相关的进行中项目（都不相关就 null），item 与 question 给 null。
3. kind=unclear：太含糊，判断不出是什么（比如只有一个词、看不出是哪件事或想要什么）→ question 写一句问用户的话，
   直接问缺的那一点，不要复述笔记的时间和标题（系统会自动加上）；item 与 project_id 给 null。

目标：
{goals}

进行中的项目：
{projects}
{attached}
笔记原文：
{note}
{images}
{rules}
只输出符合 schema 的 JSON。"""


def validate_item_draft(draft: dict, goal_ids: set[str], where: str) -> None:
    require_fields(draft, ITEM_DRAFT_FIELDS, where)
    for f in ("title", "next_step", "done_definition"):
        require_nonempty_str(draft, f, where)
    require_enum(draft, "category", CATEGORIES, where)
    require_enum(draft, "owner", OWNERS, where)
    require_aware_datetime_or_null(draft, "next_at", where)
    if draft["goal_id"] is not None and draft["goal_id"] not in goal_ids:
        raise ValidationError(f"{where}: goal_id={draft['goal_id']!r} not in {sorted(goal_ids)}")


def _validate_note_result(result: dict, goal_ids: set[str], project_ids: set[str]) -> None:
    where = "claude note"
    require_fields(result, ("kind", "item", "project_id", "question"), where)
    require_enum(result, "kind", NOTE_KINDS, where)
    expected = {"task": "item", "note": None, "unclear": "question"}[result["kind"]]
    for f in ("item", "question"):
        if (result[f] is not None) != (f == expected):
            raise ValidationError(f"{where}: kind={result['kind']} but {f}={result[f]!r}")
    if result["kind"] != "note" and result["project_id"] is not None:
        raise ValidationError(f"{where}: kind={result['kind']} but project_id={result['project_id']!r}")
    if result["project_id"] is not None and result["project_id"] not in project_ids:
        raise ValidationError(f"{where}: project_id {result['project_id']!r} not in {sorted(project_ids)}")
    if result["kind"] == "task":
        validate_item_draft(result["item"], goal_ids, f"{where} item")
        require_fields(result["item"], ("project_id",), f"{where} item")
        pid = result["item"]["project_id"]
        if pid is not None and pid not in project_ids:
            raise ValidationError(f"{where} item: project_id {pid!r} not in {sorted(project_ids)}")
    if result["kind"] == "unclear":
        require_nonempty_str(result, "question", where)


def process_note(hub: Hub, job: dict, lang: str) -> None:
    """Every note is sorted into one of three (api.md 简化): a task becomes an active item the note is
    linked to; an idea/record is linked to its project; an unclear note gets a question in chat.
    Attached images go to Claude as image blocks, like chat images (api.md 笔记带图片)."""
    note = hub.get_record(job["record_id"])
    images = [hub.get_attachment(a["id"]) for a in note["attachments"]]
    goals = hub.list_goals()
    active_projects = hub.list_projects("active")
    attached = ""
    if note["item_id"] is not None:
        attached = f"\n这条笔记挂在已有事项上（供参考）：\n{dump(hub.get_item(note['item_id'])['item'])}\n"
    if note["card_id"] is not None:
        attached += f"\n这条笔记来自信息流的这张卡片：\n{dump(hub.get_card(note['card_id']))}\n"
    prompt = NOTE_PROMPT.format(
        now=now_context(),
        goals=dump([{k: g[k] for k in ("id", "title", "status")} for g in goals]),
        projects=dump([{k: p[k] for k in ("id", "title", "area", "summary")} for p in active_projects]),
        attached=attached,
        note=dump({"title": note["title"], "body": note["body"], "at": note["at"]}),
        images=(f"笔记附了 {len(images)} 张图片（就是这次输入里的图片），整理时要结合图片内容（图里可能才是要办的事）。\n"
                if images else ""),
        rules=user_text_rules(lang),
    )
    result = claude.ask_json_with_images(prompt, images, NOTE_SCHEMA)
    _validate_note_result(result, {g["id"] for g in goals}, {p["id"] for p in active_projects})

    if result["kind"] == "task":
        _record_as_item(hub, note, result["item"], lang)
    elif result["kind"] == "note":
        if result["project_id"] is not None:
            hub.link_record(note["id"], note["item_id"], result["project_id"])  # keep an existing item link
    else:
        _ask_about_note(hub, note, result["question"], lang)


def _record_as_item(hub: Hub, note: dict, item: dict, lang: str) -> None:
    """Active item + the note linked to it; the hub writes the undoable "由笔记记成事项" record."""
    item_id = f"note-{note['id']}"
    hub.put_item(item_id, {
        **{f: item[f] for f in ITEM_DRAFT_FIELDS},
        "status": "active",
        "progress": None,
        "project_id": item["project_id"],
    })
    hub.link_record(note["id"], item_id, item["project_id"])
    title = say(lang, "已记成事项：{title}", title=item["title"])
    hub.post_event(kind="chat", tier="log", item_id=item_id, project_id=item["project_id"],
                   title=title[:TITLE_CHARS], body=title, evidence=f"record:{note['id']}")


def _ask_about_note(hub: Hub, note: dict, question: str, lang: str) -> None:
    """Too vague to sort: ask in chat; nothing is created or linked."""
    question = question.strip()
    hub.post_event(
        kind="chat",
        tier="digest",
        item_id=note["item_id"],
        project_id=note["project_id"],
        title=question[:TITLE_CHARS],
        body=say(lang, "关于你 {at} 记的「{title}」：{question}\n在对话里回我就行。",
                 at=short_time(note["at"]), title=note["title"], question=question),
        evidence=f"record:{note['id']}",
    )


# ---------------------------------------------------------------- refresh

REFRESH_SCHEMA = {
    "type": "object",
    "properties": {
        "updates": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "item_id": {"type": "string"},
                    "next_step": {"type": "string"},
                    "next_at": {"type": ["string", "null"]},
                    "reason": {"type": "string"},
                },
                "required": ["item_id", "next_step", "next_at", "reason"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["updates"],
    "additionalProperties": False,
}

REFRESH_PROMPT = """你在帮用户刷新 mojito 个人事项系统里进行中的事项。

{now}

下面是进行中的事项（每个附带它最近的记录）、今日重点、当前计划、接下来的日程、最近的对话（含用户晚上"今天推进了什么"的回复）和全局最近记录。
请判断哪些事项的 next_step / next_at 应该更新。规则：
- 今日重点里的事项：next_step 必须是"今天能做的一小步"——具体、半小时到两小时能做完、做完就能看到进展。
  如果现在的 next_step 太大、太空、已经做完或和计划进度 / 日程 / 晚间回复对不上，就按这些信息改成今天能做的一小步（必要时调 next_at）。
- 其他事项：只有在记录里有依据时才改（例如下一步已经做了、情况变了、时间已过需要重新安排）；没有依据就不要列出。
- next_step：一句话，具体可执行。
- next_at：ISO-8601 带用户时区的偏移（和上面"现在"里的偏移一致），或 null。
- reason：一两句话说明依据，引用具体记录的标题或时间。
- 不能改 done_definition、status 等其他字段。
- updates 里只放确实要改的事项；都不需要改就给空数组。

今日重点（事项 id）：{focus}

当前计划（含事项与进展，没有为 null）：
{plan}

接下来 7 天的日程：
{calendar}

最近对话（倒序）：
{chat}

进行中的事项：
{items}

全局最近记录（倒序）：
{records}

next_step 和 reason 用户会看到。{rules}
只输出符合 schema 的 JSON。"""


def _validate_updates(result: dict, items_by_id: dict[str, dict]) -> list[dict]:
    require_fields(result, ("updates",), "claude refresh")
    for i, u in enumerate(result["updates"]):
        where = f"claude refresh updates[{i}]"
        require_fields(u, ("item_id", "next_step", "next_at", "reason"), where)
        if u["item_id"] not in items_by_id:
            raise ValidationError(f"{where}: item_id={u['item_id']!r} is not an in-progress item")
        require_nonempty_str(u, "next_step", where)
        require_nonempty_str(u, "reason", where)
        require_aware_datetime_or_null(u, "next_at", where)
    return result["updates"]


def _same_instant(a: str | None, b: str | None) -> bool:
    if a is None or b is None:
        return a is b
    return datetime.fromisoformat(a) == datetime.fromisoformat(b)


def refresh(hub: Hub, job: dict, lang: str) -> None:
    _refresh_items(hub, lang)
    projects.sync(hub, lang)
    projects.write_summaries(hub, lang)
    projects.write_overviews(hub, lang)


def _refresh_items(hub: Hub, lang: str) -> None:
    items = [i for i in hub.list_items() if i["status"] in IN_PROGRESS_STATUSES]
    if not items:
        return
    items_by_id = {i["id"]: i for i in items}
    items_ctx = []
    for item in items:
        records = hub.get_item(item["id"])["records"][:ITEM_RECORDS_LIMIT]
        items_ctx.append({"item": item, "records": records})
    today = hub.get_today()
    local_today = datetime.now(ZoneInfo(TIMEZONE)).date()
    prompt = REFRESH_PROMPT.format(
        now=now_context(),
        focus=dump([i["id"] for i in today["focus"]]),
        plan=dump(hub.get_plan(today["plan"]["id"]) if today["plan"] is not None else None),
        calendar=dump(hub.calendar(local_today.isoformat(), (local_today + timedelta(days=CALENDAR_DAYS)).isoformat())),
        chat=dump([{k: r[k] for k in ("at", "author", "source", "body")} for r in hub.list_chat(CHAT_CONTEXT, None, None)]),
        items=dump(items_ctx),
        records=dump(hub.list_records(RECENT_RECORDS_LIMIT, None)),
        rules=user_text_rules(lang),
    )
    updates = _validate_updates(claude.ask_json(prompt, REFRESH_SCHEMA), items_by_id)

    for u in updates:
        item = items_by_id[u["item_id"]]
        if item["next_step"] == u["next_step"] and _same_instant(item["next_at"], u["next_at"]):
            continue
        fields = writable_item_fields(item)
        fields["next_step"] = u["next_step"]
        fields["next_at"] = u["next_at"]
        hub.put_item(item["id"], fields)
        hub.post_event(
            kind="log",
            tier="log",
            item_id=item["id"],
            project_id=item["project_id"],
            title=say(lang, "刷新：{title} 的下一步改了", title=item["title"]),
            body=say(lang, "依据：{reason}", reason=u["reason"]),
            evidence="inferred",
        )
