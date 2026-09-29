"""draft_review: two-week review of the active plan plus a draft of the next plan.

Completed / missed come from item status (script). Claude writes the summary, cross-period patterns
(each with evidence from past reviews and item records) and proposes the next plan.
"""
from datetime import date, timedelta

from mojito_worker import claude
from mojito_worker.hub import Hub
from mojito_worker.i18n import say
from mojito_worker.jobs import ITEM_DRAFT_FIELDS, ITEM_DRAFT_SCHEMA, validate_item_draft
from mojito_worker.prompting import user_text_rules, dump, now_context, short_date
from mojito_worker.validate import ValidationError, require_fields, require_nonempty_str

PLAN_DAYS = 14
ITEM_RECORDS_LIMIT = 20
CLOSED_STATUSES = ("done", "closed")

NEW_ITEM_SCHEMA = {
    **ITEM_DRAFT_SCHEMA,
    "properties": {**ITEM_DRAFT_SCHEMA["properties"], "project_id": {"type": ["string", "null"]}},
    "required": [*ITEM_DRAFT_SCHEMA["required"], "project_id"],
}

REVIEW_SCHEMA = {
    "type": "object",
    "properties": {
        "summary": {"type": "string"},
        "usage": {"type": "string"},
        "patterns": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {"pattern": {"type": "string"}, "evidence": {"type": "string"}},
                "required": ["pattern", "evidence"],
                "additionalProperties": False,
            },
        },
        "next_plan": {
            "type": ["object", "null"],
            "properties": {
                "goal_ids": {"type": "array", "items": {"type": "string"}},
                "continue_item_ids": {"type": "array", "items": {"type": "string"}},
                "new_items": {"type": "array", "items": NEW_ITEM_SCHEMA},
            },
            "required": ["goal_ids", "continue_item_ids", "new_items"],
            "additionalProperties": False,
        },
    },
    "required": ["summary", "usage", "patterns", "next_plan"],
    "additionalProperties": False,
}

PROMPT = """你在为用户的 mojito 两周计划写复盘，并起草下一期计划。
{now}

本期计划（含目标和事项）：
{current}

脚本按事项状态算出的结果（不要改）：
- 完成：{completed}
- 未完成：{missed}

本期每个事项最近的记录（倒序）：
{records}

往期计划和复盘（用来找跨期规律）：
{history}

本期 app 使用统计（GET /usage/summary，{plan_start} 至 {plan_end}；views/actions 为次数，unused 为一次都没用过的页面和动作）：
{usage}

全部目标：
{goals}

全部未结束的事项（下一期可以从这里挑来继续）：
{open_items}

进行中的项目（新事项的 project_id 从这里选，都不合适就 null）：
{projects}

要写的：
- summary：几句话总结本期，说清完成了什么、没完成什么、卡在哪；只依据上面的数据。
- usage：一段话"这两周用了哪些、没用哪些"：常用的页面和动作、活跃天数、一次没用的功能；只依据使用统计，不评价用户。
- patterns：跨期规律，例如"某事连续两期没完成""某类事总是拖到最后"。每条必须在 evidence 里写出依据（哪期、哪个事项、哪条记录）；没有往期数据或找不到有依据的规律就给空数组，不要编。
- next_plan：{next_plan_instructions}
summary、usage、patterns（含 evidence，会拼进 patterns 给用户看）、新事项的文字用户都会看到；evidence 用事项名、日期、记录标题指代，不写 id。
{rules}
只输出符合 schema 的 JSON。"""

NEXT_PLAN_INSTRUCTIONS = """下一期（{start} 至 {end}）的草稿，用户会确认后生效。
  - goal_ids：从 active 目标里选。
  - continue_item_ids：从"未结束的事项"里挑下一期要继续推进的 id。
  - new_items：需要新开的事项（字段要求同事项：title、category=research|life、next_step、next_at 带时区、owner=auto|me|auto_then_me、
    done_definition——最后一步需要用户本人做的写成"你做了 X"、goal_id、project_id）。没有就给空数组。"""

NEXT_PLAN_EXISTS = "下一期计划草稿已经存在（{plan_id}），这次不要起草，next_plan 给 null。"


def _plan_items_records(hub: Hub, item_ids: list[str]) -> dict[str, list[dict]]:
    return {i: hub.get_item(i)["records"][:ITEM_RECORDS_LIMIT] for i in item_ids}


def _history(hub: Hub, current_id: str) -> list[dict]:
    history = []
    for p in hub.list_plans():
        if p["id"] == current_id or p["status"] == "draft":
            continue
        detail = hub.get_plan(p["id"])
        history.append({"plan": detail["plan"], "items": detail["items"], "review": detail["review"]})
    return history


def _validate(result: dict, goal_ids: set[str], open_item_ids: set[str], project_ids: set[str],
              expect_next_plan: bool) -> None:
    require_fields(result, ("summary", "usage", "patterns", "next_plan"), "claude review")
    require_nonempty_str(result, "summary", "claude review")
    require_nonempty_str(result, "usage", "claude review")
    for i, p in enumerate(result["patterns"]):
        where = f"claude review patterns[{i}]"
        require_fields(p, ("pattern", "evidence"), where)
        require_nonempty_str(p, "pattern", where)
        require_nonempty_str(p, "evidence", where)
    nxt = result["next_plan"]
    if (nxt is not None) != expect_next_plan:
        raise ValidationError(f"claude review: next_plan expected={'object' if expect_next_plan else 'null'}, got {nxt!r}")
    if nxt is None:
        return
    require_fields(nxt, ("goal_ids", "continue_item_ids", "new_items"), "claude review next_plan")
    if not set(nxt["goal_ids"]) <= goal_ids:
        raise ValidationError(f"claude review next_plan: goal_ids {nxt['goal_ids']} not all in {sorted(goal_ids)}")
    if not set(nxt["continue_item_ids"]) <= open_item_ids:
        raise ValidationError(f"claude review next_plan: continue_item_ids {nxt['continue_item_ids']} not all open items {sorted(open_item_ids)}")
    for i, item in enumerate(nxt["new_items"]):
        where = f"claude review next_plan.new_items[{i}]"
        validate_item_draft(item, goal_ids, where)
        require_fields(item, ("project_id",), where)
        if item["project_id"] is not None and item["project_id"] not in project_ids:
            raise ValidationError(f"{where}: project_id={item['project_id']!r} not in {sorted(project_ids)}")


def draft_review(hub: Hub, job: dict, lang: str) -> None:
    current = hub.get_current_plan()
    plan = current["plan"]
    plans = hub.list_plans()
    this = next(p for p in plans if p["id"] == plan["id"])
    if this["review_status"] == "done":
        raise ValidationError(f"plan {plan['id']} review is already done")

    completed = [i["id"] for i in current["items"] if i["status"] == "done"]
    missed = [i["id"] for i in current["items"] if i["status"] != "done"]
    start = date.fromisoformat(plan["end"]) + timedelta(days=1)
    end = start + timedelta(days=PLAN_DAYS - 1)
    next_id = f"p-{start.isoformat()}"
    next_exists = any(p["id"] == next_id for p in plans)

    goals = hub.list_goals()
    active_goal_ids = {g["id"] for g in goals if g["status"] == "active"}
    open_items = [i for i in hub.list_items() if i["status"] not in CLOSED_STATUSES]
    projects = hub.list_projects("active")
    prompt = PROMPT.format(
        now=now_context(),
        current=dump(current),
        completed=dump(completed),
        missed=dump(missed),
        records=dump(_plan_items_records(hub, plan["item_ids"])),
        history=dump(_history(hub, plan["id"])),
        plan_start=plan["start"],
        plan_end=plan["end"],
        usage=dump(hub.usage_summary(plan["start"], plan["end"])),
        goals=dump(goals),
        open_items=dump(open_items),
        projects=dump([{k: p[k] for k in ("id", "title", "area", "goal_id", "summary")} for p in projects]),
        rules=user_text_rules(lang),
        next_plan_instructions=(NEXT_PLAN_EXISTS.format(plan_id=next_id) if next_exists
                                else NEXT_PLAN_INSTRUCTIONS.format(start=start, end=end)),
    )
    result = claude.ask_json(prompt, REVIEW_SCHEMA)
    _validate(result, active_goal_ids, {i["id"] for i in open_items}, {p["id"] for p in projects},
              expect_next_plan=not next_exists)

    hub.put_review(plan["id"], {
        "summary": say(lang, "{summary}\n\n这两周用了哪些、没用哪些：{usage}",
                       summary=result["summary"].strip(), usage=result["usage"].strip()),
        "completed_item_ids": completed,
        "missed_item_ids": missed,
        "patterns": [say(lang, "{pattern}（依据：{evidence}）", pattern=p["pattern"], evidence=p["evidence"])
                     for p in result["patterns"]],
    })

    nxt = result["next_plan"]
    period = {"start": short_date(date.fromisoformat(plan["start"])), "end": short_date(date.fromisoformat(plan["end"]))}
    if nxt is None:
        body = say(lang, "本期（{start}–{end}）复盘草稿已写好；下一期计划草稿之前已经起草过，没有重复起草。", **period)
    else:
        new_ids = []
        for n, item in enumerate(nxt["new_items"], start=1):
            item_id = f"{next_id}-new{n}"
            hub.put_item(item_id, {
                **{f: item[f] for f in ITEM_DRAFT_FIELDS},
                "project_id": item["project_id"],
                "status": "waiting_you",
                "progress": None,
            })
            new_ids.append(item_id)
        hub.post_plan({
            "id": next_id,
            "start": start.isoformat(),
            "end": end.isoformat(),
            "goal_ids": nxt["goal_ids"],
            "item_ids": nxt["continue_item_ids"] + new_ids,
            "revises": None,
        })
        body = say(lang, "本期（{start}–{end}）复盘草稿已写好：完成 {done} 件，未完成 {missed} 件。"
                   "下一期（{next_start}–{next_end}）计划草稿：继续 {cont} 件、新开 {new} 件。去计划页写一句复盘、确认后再批准下一期。",
                   **period, done=len(completed), missed=len(missed), next_start=short_date(start), next_end=short_date(end),
                   cont=len(nxt["continue_item_ids"]), new=len(new_ids))
    hub.post_event(kind="log", tier="digest", item_id=None, project_id=None, title=say(lang, "复盘草稿好了"), body=body, evidence="inferred")
