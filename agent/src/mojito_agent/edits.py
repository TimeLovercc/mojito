"""Chat edits to the user's own data: item_updates (applied directly; the hub records each change with an item undo)
and plan_changes (drafted as a revision plan that goes to 需要你)."""
import re
from datetime import date, datetime
from zoneinfo import ZoneInfo

from mojito_agent.config import TIMEZONE
from mojito_agent.hub import Hub
from mojito_agent.validate import ValidationError, require_aware_datetime_or_null, require_enum, require_nonempty_str

LOCAL_TZ = ZoneInfo(TIMEZONE)
ITEM_STATUSES = ("active", "waiting_you", "scheduled", "standing", "done", "closed")
OPEN_STATUSES = ("active", "waiting_you", "scheduled", "standing")
OWNERS = ("auto", "me", "auto_then_me")
# Fields a chat may change; done_definition is never among them.
CHANGE_FIELDS = ("next_step", "next_at", "status", "owner", "title", "project_id")
# Request body of PUT /items/{id}.
ITEM_WRITABLE = ("title", "category", "status", "next_step", "next_at", "owner", "done_definition", "goal_id", "progress",
                 "project_id")
ITEM_UPDATES_SCHEMA = {
    "type": "array",
    "items": {
        "type": "object",
        "properties": {
            "item_id": {"type": "string"},
            "changes": {
                "type": "object",
                "description": "only the fields to change",
                "properties": {
                    "next_step": {"type": "string"},
                    "next_at": {"type": ["string", "null"], "description": "ISO-8601 datetime with offset, or null"},
                    "status": {"type": "string", "enum": list(ITEM_STATUSES)},
                    "owner": {"type": "string", "enum": list(OWNERS)},
                    "title": {"type": "string"},
                    "project_id": {"type": ["string", "null"]},
                },
                "additionalProperties": False,
            },
        },
        "required": ["item_id", "changes"],
        "additionalProperties": False,
    },
}

PLAN_CHANGES_SCHEMA = {
    "type": ["object", "null"],
    "properties": {
        "add_item_ids": {"type": "array", "items": {"type": "string"}},
        "remove_item_ids": {"type": "array", "items": {"type": "string"}},
        "goal_ids": {"type": ["array", "null"], "items": {"type": "string"}, "description": "new goal list, or null to keep"},
    },
    "required": ["add_item_ids", "remove_item_ids", "goal_ids"],
    "additionalProperties": False,
}


# ---------------------------------------------------------------- item_updates

def validate_item_updates(updates: list[dict], items_by_id: dict[str, dict], project_ids: set[str]) -> None:
    for i, u in enumerate(updates):
        where = f"claude chat item_updates[{i}]"
        if u["item_id"] not in items_by_id:
            raise ValidationError(f"{where}: item_id={u['item_id']!r} does not exist")
        changes = u["changes"]
        if not changes:
            raise ValidationError(f"{where}: changes is empty")
        unknown = set(changes) - set(CHANGE_FIELDS)
        if unknown:
            raise ValidationError(f"{where}: fields {sorted(unknown)} cannot be changed (allowed {CHANGE_FIELDS})")
        for f in ("next_step", "title"):
            if f in changes:
                require_nonempty_str(changes, f, where)
        if "next_at" in changes:
            require_aware_datetime_or_null(changes, "next_at", where)
        if "status" in changes:
            require_enum(changes, "status", ITEM_STATUSES, where)
        if "owner" in changes:
            require_enum(changes, "owner", OWNERS, where)
        if "project_id" in changes and changes["project_id"] is not None and changes["project_id"] not in project_ids:
            raise ValidationError(f"{where}: project_id={changes['project_id']!r} not an active project {sorted(project_ids)}")


def _same(field: str, a, b) -> bool:
    if field == "next_at" and a is not None and b is not None:
        return datetime.fromisoformat(a) == datetime.fromisoformat(b)
    return a == b


def apply_item_updates(hub: Hub, updates: list[dict], items_by_id: dict[str, dict]) -> None:
    """Full write-back PUT /items/{id}: the current item with only the changed fields replaced (done_definition is
    carried over unchanged). The hub writes the "<事项>：<字段> 从 X 改成 Y" record with the item undo itself."""
    for u in updates:
        item = items_by_id[u["item_id"]]
        changed = {f: v for f, v in u["changes"].items() if not _same(f, item[f], v)}
        if not changed:
            continue
        body = {f: item[f] for f in ITEM_WRITABLE}
        body.update(changed)
        hub.put_item(item["id"], body)


# ---------------------------------------------------------------- plan_changes

def validate_plan_changes(changes: dict | None, current: dict | None, all_item_ids: set[str], goal_ids: set[str]) -> None:
    if changes is None:
        return
    where = "claude chat plan_changes"
    if current is None:
        raise ValidationError(f"{where}: there is no active plan to revise")
    in_plan = set(current["plan"]["item_ids"])
    for i in changes["add_item_ids"]:
        if i not in all_item_ids:
            raise ValidationError(f"{where}: add_item_ids {i!r} does not exist")
        if i in in_plan:
            raise ValidationError(f"{where}: add_item_ids {i!r} is already in the plan")
    for i in changes["remove_item_ids"]:
        if i not in in_plan:
            raise ValidationError(f"{where}: remove_item_ids {i!r} is not in the plan {sorted(in_plan)}")
    if changes["goal_ids"] is not None:
        unknown = set(changes["goal_ids"]) - goal_ids
        if unknown:
            raise ValidationError(f"{where}: goal_ids {sorted(unknown)} do not exist")
    if not changes["add_item_ids"] and not changes["remove_item_ids"] and changes["goal_ids"] is None:
        raise ValidationError(f"{where}: changes nothing")


def draft_plan_revision(hub: Hub, changes: dict, current: dict) -> dict:
    """POST /plans: id <plan id>-r<local YYYYMMDDHHMMSS>, same start/end, adjusted item_ids/goal_ids, revises = the active
    plan. Lands in 需要你 as a draft."""
    plan = current["plan"]
    removed = set(changes["remove_item_ids"])
    item_ids = [i for i in plan["item_ids"] if i not in removed] + changes["add_item_ids"]
    goal_ids = plan["goal_ids"] if changes["goal_ids"] is None else changes["goal_ids"]
    return hub.post_plan(plan_id=f"{plan['id']}-r{datetime.now(LOCAL_TZ):%Y%m%d%H%M%S}", start=plan["start"], end=plan["end"],
                         goal_ids=goal_ids, item_ids=item_ids, revises=plan["id"])


# ---------------------------------------------------------------- everything else the user asks for in chat
# All applied directly (PUT/POST); the hub writes the "从 X 改成 Y" record with an undo for goals, plans, projects,
# settings, card status and note links, so nothing here writes records itself.

GOAL_STATUSES = ("active", "done", "dropped")
PROJECT_STATUSES = ("proposed", "active", "paused", "done", "declined")
AREAS = ("research", "life")
CARD_STATUSES = ("saved", "dismissed", "new")
HHMM = r"^([01][0-9]|2[0-3]):[0-5][0-9]$"

ID_PATTERN = r"^[a-z0-9][a-z0-9-]{0,62}$"
GOAL_UPDATES_SCHEMA = {
    "type": "array",
    "items": {
        "type": "object",
        "properties": {
            "goal_id": {"type": "string", "description": "existing goal id; a new id (lowercase slug) creates the goal"},
            "changes": {
                "type": "object",
                "properties": {"title": {"type": "string"}, "status": {"type": "string", "enum": list(GOAL_STATUSES)}},
                "additionalProperties": False,
            },
        },
        "required": ["goal_id", "changes"],
        "additionalProperties": False,
    },
}

PLAN_UPDATES_SCHEMA = {
    "type": "array",
    "items": {
        "type": "object",
        "properties": {
            "plan_id": {"type": "string"},
            "add_item_ids": {"type": "array", "items": {"type": "string"}},
            "remove_item_ids": {"type": "array", "items": {"type": "string"}},
            "goal_ids": {"type": ["array", "null"], "items": {"type": "string"}, "description": "new goal list, or null to keep"},
            "start": {"type": ["string", "null"], "description": "YYYY-MM-DD, or null to keep"},
            "end": {"type": ["string", "null"], "description": "YYYY-MM-DD, or null to keep"},
        },
        "required": ["plan_id", "add_item_ids", "remove_item_ids", "goal_ids", "start", "end"],
        "additionalProperties": False,
    },
}

PROJECT_UPDATES_SCHEMA = {
    "type": "array",
    "items": {
        "type": "object",
        "properties": {
            "project_id": {"type": "string", "description": "existing project id; a new id (lowercase slug) creates the project"},
            "changes": {
                "type": "object",
                "properties": {
                    "title": {"type": "string"},
                    "area": {"type": "string", "enum": list(AREAS)},
                    "status": {"type": "string", "enum": list(PROJECT_STATUSES)},
                    "repo_path": {"type": ["string", "null"]},
                    "goal_id": {"type": ["string", "null"]},
                },
                "additionalProperties": False,
            },
        },
        "required": ["project_id", "changes"],
        "additionalProperties": False,
    },
}

SETTINGS_UPDATE_SCHEMA = {
    "type": ["object", "null"],
    "properties": {
        "changes": {
            "type": "object",
            "properties": {
                "morning_at": {"type": "string", "description": f"HH:MM ({TIMEZONE})"},
                "evening_at": {"type": "string", "description": f"HH:MM ({TIMEZONE})"},
                "evening_enabled": {"type": "boolean"},
            },
            "additionalProperties": False,
        },
    },
    "required": ["changes"],
    "additionalProperties": False,
}

CARD_ACTIONS_SCHEMA = {
    "type": "array",
    "items": {
        "type": "object",
        "properties": {"card_id": {"type": "string"}, "status": {"type": "string", "enum": list(CARD_STATUSES)}},
        "required": ["card_id", "status"],
        "additionalProperties": False,
    },
}

NOTE_LINKS_SCHEMA = {
    "type": "array",
    "items": {
        "type": "object",
        "properties": {
            "record_id": {"type": "string", "description": "a note of the user's"},
            "item_id": {"type": ["string", "null"]},
            "project_id": {"type": ["string", "null"]},
        },
        "required": ["record_id", "item_id", "project_id"],
        "additionalProperties": False,
    },
}

TASTE_NOTES_SCHEMA = {"type": "array", "items": {"type": "string"}}


def _where(name: str, i: int) -> str:
    return f"claude chat {name}[{i}]"


def _require_new_id(value: str, where: str) -> None:
    if not re.match(ID_PATTERN, value):
        raise ValidationError(f"{where}: new id {value!r} must be a lowercase slug ({ID_PATTERN})")


def validate_goal_updates(updates: list[dict], goals_by_id: dict[str, dict]) -> None:
    for i, u in enumerate(updates):
        where = _where("goal_updates", i)
        changes = u["changes"]
        if u["goal_id"] not in goals_by_id:
            _require_new_id(u["goal_id"], where)
            missing = [f for f in ("title", "status") if f not in changes]
            if missing:
                raise ValidationError(f"{where}: a new goal needs {missing}, got {changes}")
        elif not changes:
            raise ValidationError(f"{where}: changes nothing")
        if "title" in changes:
            require_nonempty_str(changes, "title", where)


def apply_goal_updates(hub: Hub, updates: list[dict], goals_by_id: dict[str, dict]) -> None:
    for u in updates:
        if u["goal_id"] not in goals_by_id:
            hub.put_goal(u["goal_id"], title=u["changes"]["title"], status=u["changes"]["status"])
            continue
        goal = goals_by_id[u["goal_id"]]
        new = {"title": goal["title"], "status": goal["status"], **u["changes"]}
        if new != {"title": goal["title"], "status": goal["status"]}:
            hub.put_goal(goal["id"], title=new["title"], status=new["status"])


def validate_plan_updates(updates: list[dict], plans_by_id: dict[str, dict], all_item_ids: set[str], goal_ids: set[str]) -> None:
    for i, u in enumerate(updates):
        where = _where("plan_updates", i)
        if u["plan_id"] not in plans_by_id:
            raise ValidationError(f"{where}: plan_id={u['plan_id']!r} is not an active or draft plan {sorted(plans_by_id)}")
        in_plan = set(plans_by_id[u["plan_id"]]["item_ids"])
        for item_id in u["add_item_ids"]:
            if item_id not in all_item_ids or item_id in in_plan:
                raise ValidationError(f"{where}: add_item_ids {item_id!r} does not exist or is already in the plan")
        for item_id in u["remove_item_ids"]:
            if item_id not in in_plan:
                raise ValidationError(f"{where}: remove_item_ids {item_id!r} is not in the plan {sorted(in_plan)}")
        if u["goal_ids"] is not None and set(u["goal_ids"]) - goal_ids:
            raise ValidationError(f"{where}: goal_ids {sorted(set(u['goal_ids']) - goal_ids)} do not exist")
        for f in ("start", "end"):
            if u[f] is not None:
                date.fromisoformat(u[f])
        if not (u["add_item_ids"] or u["remove_item_ids"] or u["goal_ids"] is not None or u["start"] or u["end"]):
            raise ValidationError(f"{where}: changes nothing")


def apply_plan_updates(hub: Hub, updates: list[dict], plans_by_id: dict[str, dict]) -> None:
    for u in updates:
        plan = plans_by_id[u["plan_id"]]
        removed = set(u["remove_item_ids"])
        hub.put_plan(
            plan["id"],
            start=plan["start"] if u["start"] is None else u["start"],
            end=plan["end"] if u["end"] is None else u["end"],
            goal_ids=plan["goal_ids"] if u["goal_ids"] is None else u["goal_ids"],
            item_ids=[i for i in plan["item_ids"] if i not in removed] + u["add_item_ids"],
        )


def validate_project_updates(updates: list[dict], projects_by_id: dict[str, dict], goal_ids: set[str]) -> None:
    for i, u in enumerate(updates):
        where = _where("project_updates", i)
        changes = u["changes"]
        if u["project_id"] not in projects_by_id:
            _require_new_id(u["project_id"], where)
            missing = [f for f in ("title", "area", "goal_id") if f not in changes]
            if missing:
                raise ValidationError(f"{where}: a new project needs {missing}, got {changes}")
            if "status" in changes and changes["status"] != "active":
                raise ValidationError(f"{where}: a new project is always created active, got status={changes['status']!r}")
        elif not changes:
            raise ValidationError(f"{where}: changes nothing")
        if "title" in changes:
            require_nonempty_str(changes, "title", where)
        if "goal_id" in changes and changes["goal_id"] is not None and changes["goal_id"] not in goal_ids:
            raise ValidationError(f"{where}: goal_id={changes['goal_id']!r} does not exist")


def apply_project_updates(hub: Hub, updates: list[dict], projects_by_id: dict[str, dict]) -> None:
    for u in updates:
        changes = u["changes"]
        if u["project_id"] not in projects_by_id:
            hub.post_project(project_id=u["project_id"], title=changes["title"], area=changes["area"],
                             repo_path=changes["repo_path"] if "repo_path" in changes else None, goal_id=changes["goal_id"])
            continue
        project = projects_by_id[u["project_id"]]
        body = {f: project[f] for f in ("title", "area", "status", "repo_path", "goal_id")}
        if {**body, **changes} != body:
            hub.put_project(project["id"], {**body, **changes})


def validate_settings_update(update: dict | None) -> None:
    if update is None:
        return
    changes = update["changes"]
    if not changes:
        raise ValidationError("claude chat settings_update: changes nothing")
    for f in ("morning_at", "evening_at"):
        if f in changes and not re.match(HHMM, changes[f]):
            raise ValidationError(f"claude chat settings_update: {f}={changes[f]!r} is not HH:MM")


def apply_settings_update(hub: Hub, update: dict | None) -> None:
    """GET /settings, merge, PUT (the full settings are re-read so a concurrent app change is not overwritten)."""
    if update is None:
        return
    settings = hub.get_settings()
    new = {**settings, **update["changes"]}
    if new != settings:
        hub.put_settings(new)


def validate_card_actions(actions: list[dict], card_ids: set[str]) -> None:
    for i, a in enumerate(actions):
        if a["card_id"] not in card_ids:
            raise ValidationError(f"{_where('card_actions', i)}: card_id={a['card_id']!r} is not a card in the context")


def apply_card_actions(hub: Hub, actions: list[dict]) -> None:
    for a in actions:
        hub.set_card_status(a["card_id"], a["status"])


def validate_note_links(links: list[dict], note_ids: set[str], item_ids: set[str], project_ids: set[str]) -> None:
    for i, link in enumerate(links):
        where = _where("note_links", i)
        if link["record_id"] not in note_ids:
            raise ValidationError(f"{where}: record_id={link['record_id']!r} is not one of the user's recent notes")
        if link["item_id"] is not None and link["item_id"] not in item_ids:
            raise ValidationError(f"{where}: item_id={link['item_id']!r} does not exist")
        if link["project_id"] is not None and link["project_id"] not in project_ids:
            raise ValidationError(f"{where}: project_id={link['project_id']!r} does not exist")


def apply_note_links(hub: Hub, links: list[dict]) -> None:
    for link in links:
        hub.link_record(link["record_id"], item_id=link["item_id"], project_id=link["project_id"])


def validate_taste_notes(notes: list[str]) -> None:
    for i, text in enumerate(notes):
        if not text.strip():
            raise ValidationError(f"{_where('taste_notes', i)}: empty taste note")


def apply_taste_notes(hub: Hub, notes: list[str]) -> None:
    for text in notes:
        hub.post_taste(text.strip())


# ---------------------------------------------------------------- subscriptions (papers / mail)

SUBSCRIPTION_UPDATES_SCHEMA = {
    "type": "array",
    "items": {
        "type": "object",
        "properties": {
            "id": {"type": "string"},
            "changes": {
                "type": "object",
                "properties": {
                    "at": {"type": "string", "description": f"HH:MM ({TIMEZONE})"},
                    "enabled": {"type": "boolean"},
                    "config": {
                        "type": "object",
                        "description": "full new config; papers / mail take none: {}",
                        "properties": {},
                        "additionalProperties": False,
                    },
                },
                "additionalProperties": False,
            },
        },
        "required": ["id", "changes"],
        "additionalProperties": False,
    },
}


def validate_subscription_updates(updates: list[dict], subs_by_id: dict[str, dict]) -> None:
    for i, u in enumerate(updates):
        where = _where("subscription_updates", i)
        if u["id"] not in subs_by_id:
            raise ValidationError(f"{where}: subscription {u['id']!r} does not exist {sorted(subs_by_id)}")
        changes = u["changes"]
        if not changes:
            raise ValidationError(f"{where}: changes nothing")
        if "at" in changes and not re.match(HHMM, changes["at"]):
            raise ValidationError(f"{where}: at={changes['at']!r} is not HH:MM")
        if "config" in changes and changes["config"]:
            raise ValidationError(f"{where}: {subs_by_id[u['id']]['kind']} takes no config, got {changes['config']}")


def apply_subscription_updates(hub: Hub, updates: list[dict], subs_by_id: dict[str, dict]) -> None:
    """enabled → POST .../enabled; at / config → PUT (both keep the other value). The hub records each with an undo."""
    for u in updates:
        sub = subs_by_id[u["id"]]
        changes = u["changes"]
        if "enabled" in changes and changes["enabled"] != sub["enabled"]:
            hub.set_subscription_enabled(sub["id"], changes["enabled"])
        at = changes["at"] if "at" in changes else sub["at"]
        config = changes["config"] if "config" in changes else sub["config"]
        if (at, config) != (sub["at"], sub["config"]):
            hub.put_subscription(sub["id"], at=at, config=config)
