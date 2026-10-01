"""Change records with hub-side undo for goals, plans, projects, settings and note links
(api.md 大批改进 §5; items have the same scheme in main.py with their own item_changes).

Every recorded write logs the changed fields in entity_changes and writes one log record
"<object>：<field> 从 X 改成 Y" carrying undo {"type", "<type>_id"?, "before"}. The undo
mark (last entity_changes.seq at write time) lets an undo refuse when one of those fields
changed again afterwards."""

import json
import sqlite3
from datetime import datetime

from fastapi import HTTPException

from . import db, labels
from .models import Record

# entity → (table, fields that are recorded and restorable, undo key of the id)
ENTITIES = {
    "goal": ("goals", ("title", "status"), "goal_id"),
    "plan": ("plans", ("start", "end", "goal_ids", "item_ids"), "plan_id"),
    "project": ("projects", ("title", "area", "status", "repo_path", "goal_id"), "project_id"),
    "settings": ("settings", ("morning_at", "evening_at", "evening_enabled", "notify", "language"), None),
    "note": ("records", ("item_id", "project_id"), "record_id"),
    "subscription": ("subscriptions", ("at", "enabled", "config"), "subscription_id"),
}
SETTINGS_ID = 1


def _decode(field: str, raw):
    """DB value → API value (what `before` stores)."""
    if raw is None:
        return None
    if field in ("goal_ids", "item_ids", "config", "notify"):
        return json.loads(raw)
    if field in ("evening_enabled", "enabled"):
        return bool(raw)
    return raw


def _encode(field: str, value):
    if value is None:
        return None
    if field in ("goal_ids", "item_ids", "config", "notify"):
        return json.dumps(value)
    if field in ("evening_enabled", "enabled"):
        return int(value)
    return value


def row(entity: str, id_) -> sqlite3.Row:
    table = ENTITIES[entity][0]
    return db.one(f"SELECT * FROM {table} WHERE id = ?", id_)


def _heading(entity: str, r: sqlite3.Row) -> str:
    if entity == "goal":
        return labels.t("heading_goal", x=r["title"])
    if entity == "plan":
        return labels.t("heading_plan", start=labels.short_date(r["start"]), end=labels.short_date(r["end"]))
    if entity == "project":
        return labels.t("heading_project", x=r["title"])
    if entity == "settings":
        return labels.t("heading_settings")
    if entity == "subscription":
        return labels.t("heading_subscription", x=labels.name("subscription", r["kind"]))
    return labels.t("heading_note", x=r["title"])


def _last_seq() -> int:
    return db.one("SELECT COALESCE(MAX(seq), 0) AS s FROM entity_changes")["s"]


def log_changes(entity: str, id_, old: sqlite3.Row, at: datetime) -> list[str]:
    """Log which recorded fields differ from `old` (call after the write). Every write path of
    these fields must call this (directly or via record), or undo cannot see later changes."""
    new = row(entity, id_)
    changed = [f for f in ENTITIES[entity][1] if old[f] != new[f]]
    db.conn.executemany("INSERT INTO entity_changes (entity, entity_id, field, at) VALUES (?, ?, ?, ?)",
                        [(entity, str(id_), f, db.ts(at)) for f in changed])
    return changed


def record(entity: str, id_, old: sqlite3.Row, at: datetime, *, author: str, source: str) -> Record | None:
    """Call after writing an existing object (inside the transaction). None if nothing
    recorded changed."""
    changed = log_changes(entity, id_, old, at)
    if not changed:
        return None
    new = row(entity, id_)
    undo = {"type": entity, "before": {f: _decode(f, old[f]) for f in changed}}
    key = ENTITIES[entity][2]
    if key is not None:
        undo[key] = id_
    title = labels.titled(_heading(entity, new), labels.t("changes_sep").join(
        labels.entity_change(entity, f, _decode(f, old[f]), _decode(f, new[f])) for f in changed))
    rec = db.insert_record(
        at=at, author=author, source=source, kind="log", tier="log", item_id=None,
        project_id=id_ if entity == "project" else None, title=title, body="", evidence=None,
        needs_processing=False, undo=undo, card_id=None, category=None,
        smoke=entity == "note" and bool(new["smoke"]),  # re-linking a smoke note stays smoke
    )
    db.conn.execute("INSERT INTO undo_marks (record_id, change_seq) VALUES (?, ?)", (rec.id, _last_seq()))
    return rec


def undo(rec: sqlite3.Row, spec: dict, at: datetime) -> None:
    """Restore `before` (inside the caller's transaction checks happen first). 409 when a
    restored field changed again after the change record was written."""
    entity = spec["type"]
    key = ENTITIES[entity][2]
    id_ = SETTINGS_ID if key is None else spec[key]
    before = spec["before"]
    mark = db.one("SELECT change_seq FROM undo_marks WHERE record_id = ?", rec["id"])["change_seq"]
    later = db.all_(
        f"SELECT DISTINCT field FROM entity_changes WHERE entity = ? AND entity_id = ? AND seq > ?"
        f" AND field IN ({', '.join('?' * len(before))})",
        entity, str(id_), mark, *before,
    )
    if later:
        names = labels.joined([labels.entity_field(entity, r["field"]) for r in later])
        raise HTTPException(409, labels.t("changed_later", x=names))
    old = row(entity, id_)
    table = ENTITIES[entity][0]
    db.conn.execute(f"UPDATE {table} SET {', '.join(f'{f} = ?' for f in before)} WHERE id = ?",
                    (*(_encode(f, v) for f, v in before.items()), id_))
    log_changes(entity, id_, old, at)
    db.insert_record(
        at=at, author="me", source="app", kind="log", tier="log", item_id=None,
        project_id=id_ if entity == "project" else None, title=labels.t("undone", x=rec["title"]),
        body=labels.t("restored", x=labels.t("parts_sep").join(
            labels.t("field_value", field=labels.entity_field(entity, f), value=restored_text(entity, f, v))
            for f, v in before.items())),
        evidence=None, needs_processing=False, undo=None, card_id=None, category=None, smoke=bool(rec["smoke"]),
    )


def restored_text(entity: str, field: str, value) -> str:
    if field in ("goal_ids", "item_ids"):
        table = "goals" if field == "goal_ids" else "items"
        return labels.joined([labels.title_of(table, i) for i in value]) or labels.t("empty")
    return labels.entity_value(entity, field, value)
