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
from .models import OVERVIEW_REVIEW_FIELDS, ProjectOverview, Record

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


# ---- project overview (api.md 项目概况): written whole; only user edits (source=me) are
# change records, and their undo restores the whole previous overview ----

OVERVIEW_OBJECTS = (("kill", ("state", "setting", "progress")),
                    ("paper", ("title", "format", "pending", "review", "advice", "note", "pdf_path",
                               "review_path", "dir_path")))


def overview_parts(stored: str | None) -> dict:
    """The fields a person reads, flat (one_liner, status, kill.state, …, paper.dir_path, then
    the review card; objections compare as a whole list); a missing overview, kill or paper
    reads as all None."""
    ov = None if stored is None else json.loads(stored)
    parts = {f: None if ov is None else ov[f] for f in ("one_liner", "status")}
    for obj, keys in OVERVIEW_OBJECTS:
        for k in keys:
            parts[f"{obj}.{k}"] = None if ov is None or ov[obj] is None else ov[obj][k]
    for f in OVERVIEW_REVIEW_FIELDS:
        parts[f] = None if ov is None else ov[f]
    return parts


def _changed_parts(old: str | None, new: str | None) -> list[tuple[str, object, object]]:
    before, after = overview_parts(old), overview_parts(new)
    return [(k, before[k], after[k]) for k in before if before[k] != after[k]]


def _store_overview(project_id: str, stored: str | None, at: datetime) -> sqlite3.Row:
    """Write the column; a write that changes it (metadata included) is logged so an undo
    sees it. Returns the row before the write."""
    old = row("project", project_id)
    db.conn.execute("UPDATE projects SET overview = ? WHERE id = ?", (stored, project_id))
    if old["overview"] != stored:
        db.conn.execute("INSERT INTO entity_changes (entity, entity_id, field, at) VALUES ('project', ?, 'overview', ?)",
                        (project_id, db.ts(at)))
    return old


def set_overview(project_id: str, overview: ProjectOverview, at: datetime, *, author: str, source: str) -> None:
    """Inside a transaction. project/claude writes are stored silently; a user edit
    (source=me) that changes what a person reads writes "<项目>：<字段> 从 X 改成 Y" with an undo."""
    old = _store_overview(project_id, overview.model_dump_json(), at)
    if overview.source != "me":
        return
    new = row("project", project_id)
    changed = _changed_parts(old["overview"], new["overview"])
    if not changed:
        return
    rec = db.insert_record(
        at=at, author=author, source=source, kind="log", tier="log", item_id=None, project_id=project_id,
        title=labels.titled(_heading("project", new), labels.t("changes_sep").join(
            labels.t("change", field=labels.name("field_overview", k), old=labels.overview_value(k, o),
                     new=labels.overview_value(k, n)) for k, o, n in changed)),
        body="", evidence=None, needs_processing=False,
        undo={"type": "project_overview", "project_id": project_id,
              "before": None if old["overview"] is None else json.loads(old["overview"])},
        card_id=None, category=None, smoke=False,
    )
    db.conn.execute("INSERT INTO undo_marks (record_id, change_seq) VALUES (?, ?)", (rec.id, _last_seq()))


def undo_overview(rec: sqlite3.Row, spec: dict, at: datetime) -> None:
    """Restore the whole `before` (inside a transaction); 409 when the overview was written
    again after the change record."""
    project_id = spec["project_id"]
    mark = db.one("SELECT change_seq FROM undo_marks WHERE record_id = ?", rec["id"])["change_seq"]
    if db.one("SELECT 1 FROM entity_changes WHERE entity = 'project' AND entity_id = ? AND field = 'overview'"
              " AND seq > ?", project_id, mark):
        raise HTTPException(409, labels.t("changed_later", x=labels.t("overview")))
    before = None if spec["before"] is None else ProjectOverview.model_validate(spec["before"]).model_dump_json()
    old = _store_overview(project_id, before, at)
    db.insert_record(
        at=at, author="me", source="app", kind="log", tier="log", item_id=None, project_id=project_id,
        title=labels.t("undone", x=rec["title"]),
        body=labels.t("restored", x=labels.t("parts_sep").join(
            labels.t("field_value", field=labels.name("field_overview", k), value=labels.overview_value(k, v))
            for k, _, v in _changed_parts(old["overview"], before))),
        evidence=None, needs_processing=False, undo=None, card_id=None, category=None, smoke=bool(rec["smoke"]),
    )


def restored_text(entity: str, field: str, value) -> str:
    if field in ("goal_ids", "item_ids"):
        table = "goals" if field == "goal_ids" else "items"
        return labels.joined([labels.title_of(table, i) for i in value]) or labels.t("empty")
    return labels.entity_value(entity, field, value)
