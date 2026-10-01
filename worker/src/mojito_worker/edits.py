"""Chat-driven edits of the user's own data (design 9.1 "写自己的数据直接做", api.md 大批改进 §5).

Everything the user asks for in chat is applied directly; the hub writes the "从 X 改成 Y" record and
its undo for items, goals, plans, projects and settings. Only adjustments Claude proposes on its own
(plan_changes) are drafted as a revised plan for 等你拍板. done_definition never changes; nothing is
ever sent to other people from here.

All outputs are validated first, then applied in dependency order (goals before the projects/plans
that reference them).
"""
import re
from dataclasses import dataclass
from datetime import date, datetime
from zoneinfo import ZoneInfo

from mojito_worker.config import TIMEZONE
from mojito_worker.hub import Hub, writable_item_fields
from mojito_worker.jobs import (
    ITEM_DRAFT_FIELDS,
    ITEM_DRAFT_SCHEMA,
    OWNERS,
    validate_item_draft,
)
from mojito_worker.validate import (
    ValidationError,
    require_aware_datetime_or_null,
    require_enum,
    require_fields,
    require_nonempty_str,
)

ITEM_STATUSES = ("active", "waiting_you", "scheduled", "standing", "done", "closed")
ITEM_FIELDS = ("next_step", "next_at", "status", "owner", "title", "project_id")
GOAL_STATUSES = ("active", "done", "dropped")
PROJECT_AREAS = ("research", "life")
PROJECT_STATUSES = ("active", "paused", "done")  # what chat may set; proposed/declined go through 等你拍板
PROJECT_FIELDS = ("title", "area", "status", "goal_id")
EDITABLE_PLAN_STATUSES = ("active", "draft")
CARD_STATUSES = ("saved", "dismissed", "new")
SETTINGS_FIELDS = ("morning_at", "evening_at", "evening_enabled")
NEW_ID = re.compile(r"^[a-z0-9][a-z0-9-]*$")
HHMM = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")

OUTPUT_KEYS = ("new_items", "item_updates", "goal_updates", "plan_updates", "plan_changes", "project_updates",
               "settings_update", "card_actions", "note_links", "taste_notes", "subscription_updates", "run_jobs")
# Jobs chat may start right away (api.md 对话能做的事); all run on the Mac.
RUNNABLE_JOBS = ("refresh", "sync_projects", "draft_review", "feed_brief", "feed_watch", "feed_mail")
SUBSCRIPTION_FIELDS = ("at", "enabled", "config")
# The one list chat may edit in each subscription's config (api.md 信息流改成报告); brief and mail have no config.
CONFIG_LIST = {"watch": "labs"}


def _changes_list(id_field: str, properties: dict) -> dict:
    return {
        "type": "array",
        "items": {
            "type": "object",
            "properties": {
                id_field: {"type": "string"},
                "changes": {"type": "object", "properties": properties, "additionalProperties": False},
            },
            "required": [id_field, "changes"],
            "additionalProperties": False,
        },
    }


SCHEMAS = {
    "new_items": {"type": "array", "items": {
        **ITEM_DRAFT_SCHEMA,
        "properties": {**ITEM_DRAFT_SCHEMA["properties"], "project_id": {"type": ["string", "null"]}},
        "required": [*ITEM_DRAFT_SCHEMA["required"], "project_id"],
    }},
    "item_updates": _changes_list("item_id", {
        "next_step": {"type": "string"},
        "next_at": {"type": ["string", "null"]},
        "status": {"type": "string", "enum": list(ITEM_STATUSES)},
        "owner": {"type": "string", "enum": list(OWNERS)},
        "title": {"type": "string"},
        "project_id": {"type": ["string", "null"]},
    }),
    "goal_updates": _changes_list("goal_id", {
        "title": {"type": "string"},
        "status": {"type": "string", "enum": list(GOAL_STATUSES)},
    }),
    "project_updates": _changes_list("project_id", {
        "title": {"type": "string"},
        "area": {"type": "string", "enum": list(PROJECT_AREAS)},
        "status": {"type": "string", "enum": list(PROJECT_STATUSES)},
        "goal_id": {"type": ["string", "null"]},
    }),
    "plan_updates": {
        "type": "array",
        "items": {
            "type": "object",
            "properties": {
                "plan_id": {"type": "string"},
                "add_item_ids": {"type": "array", "items": {"type": "string"}},
                "remove_item_ids": {"type": "array", "items": {"type": "string"}},
                "goal_ids": {"type": ["array", "null"], "items": {"type": "string"}},
                "start": {"type": ["string", "null"]},
                "end": {"type": ["string", "null"]},
            },
            "required": ["plan_id", "add_item_ids", "remove_item_ids", "goal_ids", "start", "end"],
            "additionalProperties": False,
        },
    },
    "plan_changes": {
        "type": ["object", "null"],
        "properties": {
            "add_item_ids": {"type": "array", "items": {"type": "string"}},
            "remove_item_ids": {"type": "array", "items": {"type": "string"}},
            "goal_ids": {"type": ["array", "null"], "items": {"type": "string"}},
        },
        "required": ["add_item_ids", "remove_item_ids", "goal_ids"],
        "additionalProperties": False,
    },
    "settings_update": {
        "type": ["object", "null"],
        "properties": {"changes": {"type": "object", "properties": {
            "morning_at": {"type": "string"},
            "evening_at": {"type": "string"},
            "evening_enabled": {"type": "boolean"},
        }, "additionalProperties": False}},
        "required": ["changes"],
        "additionalProperties": False,
    },
    "card_actions": {
        "type": "array",
        "items": {
            "type": "object",
            "properties": {"card_id": {"type": "string"}, "status": {"type": "string", "enum": list(CARD_STATUSES)}},
            "required": ["card_id", "status"],
            "additionalProperties": False,
        },
    },
    "note_links": {
        "type": "array",
        "items": {
            "type": "object",
            "properties": {
                "record_id": {"type": "string"},
                "item_id": {"type": ["string", "null"]},
                "project_id": {"type": ["string", "null"]},
            },
            "required": ["record_id", "item_id", "project_id"],
            "additionalProperties": False,
        },
    },
    "taste_notes": {"type": "array", "items": {"type": "string"}},
    "run_jobs": {"type": "array", "items": {"type": "string", "enum": list(RUNNABLE_JOBS)}},
    "subscription_updates": _changes_list("id", {
        "at": {"type": "string"},
        "enabled": {"type": "boolean"},
        "config": {
            "type": "object",
            "properties": {"labs": {"type": "array", "items": {"type": "string"}}},
            "required": ["labs"],
            "additionalProperties": False,
        },
    }),
}

INSTRUCTIONS = """用户在对话里亲口要求的改动一律直接执行（系统会自动在动态里写"从 X 改成 Y"并可撤销），不进"等你拍板"；
reply 里说清改了什么，并说可以在动态里撤销。只放用户要求的改动，没要求就给空数组 / null。每个改动只放要改的字段。
- new_items：用户要你新建事项时给（直接生效为进行中）。字段同事项：title、category（research / life）、next_step（今天或近期能做的一小步）、
  next_at（ISO-8601 带时区或 null）、owner（auto / me / auto_then_me）、done_definition（最后一步要用户本人做的写成"你做了 X"）、
  goal_id、project_id（没有就 null）。
- item_updates [{item_id, changes}]：next_step、next_at（ISO-8601 带时区或 null）、status、owner、title、project_id。
  "做完了"→ status=done；"删掉 / 不要了 / 取消 / 这件不做了"→ status=closed（事项不会真的删除）；"推到周五"→ next_at。
  done_definition 永远不能改。
- goal_updates [{goal_id, changes}]：title、status（active / done / dropped）。新建目标：goal_id 用一个新的
  小写字母数字连字符 id（如 g-trip），changes 里 title 和 status 都要给。
- project_updates [{project_id, changes}]：title、area（research / life）、status（active / paused / done）、goal_id。
  新建项目：project_id 用新的小写 id，changes 里 title、area、goal_id 都要给（新建即进行中）。
- plan_updates [{plan_id, add_item_ids, remove_item_ids, goal_ids, start, end}]：用户要求改当前（或草稿）计划时直接改；
  goal_ids / start / end 不改就 null，日期格式 YYYY-MM-DD。
- plan_changes：只有你自己觉得计划该调整、用户没要求时才用（起草修订版进"等你拍板"，用户批准才生效）；否则 null。
- settings_update {changes}：morning_at / evening_at（HH:MM，用户时区）、evening_enabled（晚上提问开关）。
- card_actions [{card_id, status}]：信息流卡片 收藏 saved / 不感兴趣 dismissed / 恢复 new。
- note_links [{record_id, item_id, project_id}]：把用户的某条笔记挂到事项 / 项目（两个都写最终值，不挂就 null）。
- taste_notes：用户说出的论文 / 信息偏好（"多推开源工具"、"少推综述"），每条一句话，写进口味档案；没有就空数组。
- subscription_updates [{id, changes}]：订阅（每日简报 / 实验室动态 / 每日邮件）。at（HH:MM，用户时区；简报、邮件是每天几点跑，
  实验室动态是从几点起每隔几小时查一次）、enabled（开关）、config：
  只有实验室动态有 {labs: [...]}（盯的实验室名单，给改完后的完整列表，别名用 / 连起来如"DeepMind/Gemini"）；简报和邮件没有 config。
  "也盯一下 Mistral"→ labs 里加"Mistral"（原有的保留）；"邮件改到 8 点"→ at="08:00"。
- run_jobs：用户要"现在跑 / 刷新一下 / 同步项目 / 现在复盘"时，列出要立刻开始的任务（每种一次）：
  refresh（刷新事项的下一步）、sync_projects（同步项目）、draft_review（起草两周复盘）、feed_brief（每日 AI 简报）、
  feed_watch（查实验室新动态）、feed_mail（每日邮件）。
  reply 里说"已开始，跑完进信息流 / 会推送"（简报、实验室动态、邮件跑完进信息流；刷新、同步、复盘跑完会推送）。没要求就空数组。
- 今日重点里的事项：对话里看出有进展或卡点时，顺手用 item_updates 把 next_step 改成"今天能做的一小步"（必要时调 next_at）。
- 对外发送（邮件、消息）仍然只起草 Draft。
- 不许声称 app 有它其实没有的功能；不确定时说"你可以在事项详情点完成 / 关闭"。"""


@dataclass(frozen=True)
class EditContext:
    items: dict[str, dict]
    goals: dict[str, dict]
    projects: dict[str, dict]
    plans: dict[str, dict]           # active + draft, the ones chat may change
    active_plan: dict | None
    subscriptions: dict[str, dict]
    card_ids: set[str]               # cards the user can be talking about (recent + the asked-about one)
    new_item_prefix: str             # ids of items created from this message: <prefix>-<n>


def _same(field: str, a, b) -> bool:
    if field == "next_at" and a is not None and b is not None:
        return datetime.fromisoformat(a) == datetime.fromisoformat(b)
    return a == b


def _check_changes(ch: dict, allowed: tuple[str, ...], where: str) -> None:
    if not ch:
        raise ValidationError(f"{where}: empty changes")
    unknown = set(ch) - set(allowed)
    if unknown:
        raise ValidationError(f"{where}: fields {sorted(unknown)} cannot be changed")


def _check_ref(value: str | None, known: set[str], what: str, where: str) -> None:
    if value is not None and value not in known:
        raise ValidationError(f"{where}: {what} {value!r} not in {sorted(known)}")


def _check_new_id(new_id: str, taken: set[str], where: str) -> None:
    if not NEW_ID.match(new_id) or new_id in taken:
        raise ValidationError(f"{where}: new id {new_id!r} invalid or already taken")


def validate(answer: dict, ctx: EditContext, hub: Hub) -> None:
    """Validate every edit output before anything is written. `hub` is only read (note records)."""
    require_fields(answer, OUTPUT_KEYS, "claude reply")

    goal_ids = set(ctx.goals)
    for i, u in enumerate(answer["goal_updates"]):
        where = f"claude reply goal_updates[{i}]"
        require_fields(u, ("goal_id", "changes"), where)
        ch = u["changes"]
        _check_changes(ch, ("title", "status"), where)
        if u["goal_id"] not in ctx.goals:
            _check_new_id(u["goal_id"], goal_ids, where)
            require_fields(ch, ("title", "status"), where)
            goal_ids.add(u["goal_id"])
        if "title" in ch:
            require_nonempty_str(ch, "title", where)
        if "status" in ch:
            require_enum(ch, "status", GOAL_STATUSES, where)

    project_ids = set(ctx.projects)
    for i, u in enumerate(answer["project_updates"]):
        where = f"claude reply project_updates[{i}]"
        require_fields(u, ("project_id", "changes"), where)
        ch = u["changes"]
        _check_changes(ch, PROJECT_FIELDS, where)
        if u["project_id"] not in ctx.projects:
            _check_new_id(u["project_id"], project_ids, where)
            require_fields(ch, ("title", "area", "goal_id"), where)
            if "status" in ch:
                raise ValidationError(f"{where}: a new project starts active; do not set status")
            project_ids.add(u["project_id"])
        if "title" in ch:
            require_nonempty_str(ch, "title", where)
        if "area" in ch:
            require_enum(ch, "area", PROJECT_AREAS, where)
        if "status" in ch:
            require_enum(ch, "status", PROJECT_STATUSES, where)
        if "goal_id" in ch:
            _check_ref(ch["goal_id"], goal_ids, "goal_id", where)

    for i, item in enumerate(answer["new_items"]):
        where = f"claude reply new_items[{i}]"
        validate_item_draft(item, goal_ids, where)
        require_fields(item, ("project_id",), where)
        _check_ref(item["project_id"], project_ids, "project_id", where)

    for i, u in enumerate(answer["item_updates"]):
        where = f"claude reply item_updates[{i}]"
        require_fields(u, ("item_id", "changes"), where)
        _check_ref(u["item_id"], set(ctx.items), "item_id", where)
        ch = u["changes"]
        _check_changes(ch, ITEM_FIELDS, where)
        for f in ("next_step", "title"):
            if f in ch:
                require_nonempty_str(ch, f, where)
        if "next_at" in ch:
            require_aware_datetime_or_null(ch, "next_at", where)
        if "status" in ch:
            require_enum(ch, "status", ITEM_STATUSES, where)
        if "owner" in ch:
            require_enum(ch, "owner", OWNERS, where)
        if "project_id" in ch:
            _check_ref(ch["project_id"], project_ids, "project_id", where)

    for i, u in enumerate(answer["plan_updates"]):
        where = f"claude reply plan_updates[{i}]"
        require_fields(u, ("plan_id", "add_item_ids", "remove_item_ids", "goal_ids", "start", "end"), where)
        _check_ref(u["plan_id"], set(ctx.plans), "plan_id (active or draft)", where)
        _check_plan_delta(u, ctx.plans[u["plan_id"]], set(ctx.items), goal_ids, where)
        start = date.fromisoformat(u["start"] if u["start"] is not None else ctx.plans[u["plan_id"]]["start"])
        end = date.fromisoformat(u["end"] if u["end"] is not None else ctx.plans[u["plan_id"]]["end"])
        if start > end:
            raise ValidationError(f"{where}: start {start} is after end {end}")

    if answer["plan_changes"] is not None:
        where = "claude reply plan_changes"
        require_fields(answer["plan_changes"], ("add_item_ids", "remove_item_ids", "goal_ids"), where)
        if ctx.active_plan is None:
            raise ValidationError(f"{where}: there is no active plan to revise")
        _check_plan_delta(answer["plan_changes"], ctx.active_plan, set(ctx.items), goal_ids, where)

    if answer["settings_update"] is not None:
        where = "claude reply settings_update"
        require_fields(answer["settings_update"], ("changes",), where)
        ch = answer["settings_update"]["changes"]
        _check_changes(ch, SETTINGS_FIELDS, where)
        for f in ("morning_at", "evening_at"):
            if f in ch and not HHMM.match(ch[f]):
                raise ValidationError(f"{where}: {f}={ch[f]!r} is not HH:MM")
        if "evening_enabled" in ch and not isinstance(ch["evening_enabled"], bool):
            raise ValidationError(f"{where}: evening_enabled must be a bool")

    for i, a in enumerate(answer["card_actions"]):
        where = f"claude reply card_actions[{i}]"
        require_fields(a, ("card_id", "status"), where)
        _check_ref(a["card_id"], ctx.card_ids, "card_id", where)
        require_enum(a, "status", CARD_STATUSES, where)

    for i, link in enumerate(answer["note_links"]):
        where = f"claude reply note_links[{i}]"
        require_fields(link, ("record_id", "item_id", "project_id"), where)
        record = hub.get_record(link["record_id"])
        if record["kind"] != "note" or record["author"] != "me":
            raise ValidationError(f"{where}: record {link['record_id']} is not one of the user's notes")
        _check_ref(link["item_id"], set(ctx.items), "item_id", where)
        _check_ref(link["project_id"], project_ids, "project_id", where)

    for i, text in enumerate(answer["taste_notes"]):
        if not text.strip():
            raise ValidationError(f"claude reply taste_notes[{i}]: empty")

    if len(set(answer["run_jobs"])) != len(answer["run_jobs"]):
        raise ValidationError(f"claude reply run_jobs: duplicates in {answer['run_jobs']}")
    for i, kind in enumerate(answer["run_jobs"]):
        if kind not in RUNNABLE_JOBS:
            raise ValidationError(f"claude reply run_jobs[{i}]: {kind!r} not in {sorted(RUNNABLE_JOBS)}")

    for i, u in enumerate(answer["subscription_updates"]):
        where = f"claude reply subscription_updates[{i}]"
        require_fields(u, ("id", "changes"), where)
        _check_ref(u["id"], set(ctx.subscriptions), "subscription id", where)
        ch = u["changes"]
        _check_changes(ch, SUBSCRIPTION_FIELDS, where)
        if "at" in ch and not HHMM.match(ch["at"]):
            raise ValidationError(f"{where}: at={ch['at']!r} is not HH:MM")
        if "enabled" in ch and not isinstance(ch["enabled"], bool):
            raise ValidationError(f"{where}: enabled must be a bool")
        if "config" in ch:
            kind = ctx.subscriptions[u["id"]]["kind"]
            if kind not in CONFIG_LIST:
                raise ValidationError(f"{where}: the {kind} subscription has no config")
            field = CONFIG_LIST[kind]
            require_fields(ch["config"], (field,), where)
            if any(not k.strip() for k in ch["config"][field]):
                raise ValidationError(f"{where}: empty entry in {field} {ch['config'][field]}")
            if field == "labs" and not ch["config"]["labs"]:
                raise ValidationError(f"{where}: labs must not be empty")


def _check_plan_delta(delta: dict, plan: dict, item_ids: set[str], goal_ids: set[str], where: str) -> None:
    if not set(delta["add_item_ids"]) <= item_ids:
        raise ValidationError(f"{where}: add_item_ids {delta['add_item_ids']} not all known items")
    if not set(delta["remove_item_ids"]) <= set(plan["item_ids"]):
        raise ValidationError(f"{where}: remove_item_ids {delta['remove_item_ids']} not all in {plan['item_ids']}")
    if delta["goal_ids"] is not None and not set(delta["goal_ids"]) <= goal_ids:
        raise ValidationError(f"{where}: goal_ids {delta['goal_ids']} not all in {sorted(goal_ids)}")


def _apply_delta(plan: dict, delta: dict) -> tuple[list[str], list[str]]:
    item_ids = [i for i in plan["item_ids"] if i not in delta["remove_item_ids"]]
    item_ids += [i for i in delta["add_item_ids"] if i not in item_ids]
    goal_ids = plan["goal_ids"] if delta["goal_ids"] is None else delta["goal_ids"]
    return item_ids, goal_ids


def apply(hub: Hub, answer: dict, ctx: EditContext) -> None:
    for u in answer["goal_updates"]:
        base = {k: ctx.goals[u["goal_id"]][k] for k in ("title", "status")} if u["goal_id"] in ctx.goals else {}
        hub.put_goal(u["goal_id"], {**base, **u["changes"]})

    for u in answer["project_updates"]:
        if u["project_id"] in ctx.projects:
            p = ctx.projects[u["project_id"]]
            hub.put_project(p["id"], {**{k: p[k] for k in (*PROJECT_FIELDS, "repo_path")}, **u["changes"]})
        else:
            ch = u["changes"]
            hub.create_project({"id": u["project_id"], "title": ch["title"], "area": ch["area"],
                                "repo_path": None, "goal_id": ch["goal_id"]})

    for n, item in enumerate(answer["new_items"], start=1):
        hub.put_item(f"{ctx.new_item_prefix}-{n}", {
            **{f: item[f] for f in ITEM_DRAFT_FIELDS},
            "project_id": item["project_id"],
            "status": "active",  # the user asked for it in chat: no 等你拍板
            "progress": None,
        })

    for u in answer["item_updates"]:
        item = ctx.items[u["item_id"]]
        changed = {f: v for f, v in u["changes"].items() if not _same(f, item[f], v)}
        if changed:
            hub.put_item(item["id"], {**writable_item_fields(item), **changed})

    for u in answer["plan_updates"]:
        plan = ctx.plans[u["plan_id"]]
        item_ids, goal_ids = _apply_delta(plan, u)
        hub.put_plan(plan["id"], {
            "start": plan["start"] if u["start"] is None else u["start"],
            "end": plan["end"] if u["end"] is None else u["end"],
            "goal_ids": goal_ids,
            "item_ids": item_ids,
        })

    if answer["plan_changes"] is not None:
        draft_plan_revision(hub, answer["plan_changes"], ctx.active_plan)

    if answer["settings_update"] is not None:
        hub.put_settings({**hub.get_settings(), **answer["settings_update"]["changes"]})

    for a in answer["card_actions"]:
        hub.set_card_status(a["card_id"], a["status"])

    for link in answer["note_links"]:
        hub.link_record(link["record_id"], link["item_id"], link["project_id"])

    for text in answer["taste_notes"]:
        hub.post_taste(text.strip())

    for u in answer["subscription_updates"]:
        sub, ch = ctx.subscriptions[u["id"]], u["changes"]
        if "at" in ch or "config" in ch:
            config = sub["config"]
            if "config" in ch:
                field = CONFIG_LIST[sub["kind"]]
                config = {**sub["config"], field: list(dict.fromkeys(k.strip() for k in ch["config"][field]))}
            at = ch["at"] if "at" in ch else sub["at"]
            if at != sub["at"] or config != sub["config"]:
                hub.put_subscription(sub["id"], at, config)
        if "enabled" in ch and ch["enabled"] != sub["enabled"]:
            hub.set_subscription_enabled(sub["id"], ch["enabled"])

    # Last, so a run sees this message's other edits (e.g. new labs).
    for kind in answer["run_jobs"]:
        hub.create_job(kind, "mac", None)


def draft_plan_revision(hub: Hub, plan_changes: dict, active_plan: dict) -> str:
    """A revision of the active plan for 等你拍板 (only for changes Claude proposes on its own)."""
    stamp = datetime.now(ZoneInfo(TIMEZONE)).strftime("%Y%m%d%H%M%S")
    plan_id = f"{active_plan['id']}-r{stamp}"
    item_ids, goal_ids = _apply_delta(active_plan, plan_changes)
    hub.post_plan({
        "id": plan_id,
        "start": active_plan["start"],
        "end": active_plan["end"],
        "goal_ids": goal_ids,
        "item_ids": item_ids,
        "revises": active_plan["id"],
    })
    return plan_id
