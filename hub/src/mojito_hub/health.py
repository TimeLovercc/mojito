"""Result health of data sources (api.md 准绳落地: 数据源结果健康). ok → warn/error writes a
pushed digest record; back to ok writes a log record. Never reported counts as ok."""

from datetime import datetime

from . import db, labels
from .models import Record
from .push import push



def report(name: str, health: str, detail: str | None, at: datetime) -> None:
    """Set the health of an existing source and push the record of an ok → warn/error change."""
    old = db.one("SELECT health FROM sources WHERE name = ?", name)["health"]
    with db.conn:
        db.conn.execute("UPDATE sources SET health = ?, health_detail = ?, health_at = ? WHERE name = ?",
                        (health, detail, db.ts(at), name))
        rec = _transition(old, health, "source_health", name, detail, at)
    if rec is not None:
        push(rec)


def report_subscription(sub_id: str, result: str, health: str, at: datetime) -> None:
    """A subscription's run result (worker), same health rules as data sources."""
    row = db.one("SELECT kind, health FROM subscriptions WHERE id = ?", sub_id)
    with db.conn:
        db.conn.execute("UPDATE subscriptions SET last_run_at = ?, last_result = ?, health = ? WHERE id = ?",
                        (db.ts(at), result, health, sub_id))
        rec = _transition(row["health"], health, "subscription_health", labels.name("subscription", row["kind"]),
                          result, at)
    if rec is not None:
        push(rec)


def _transition(old: str | None, new: str, title_key: str, name: str, detail: str | None,
                at: datetime) -> Record | None:
    """Inside a transaction. Returns the record to push."""
    was_ok = old is None or old == "ok"
    if was_ok and new != "ok":
        return db.insert_record(
            at=at, author="system", source="hub", kind="alert", tier="digest", item_id=None, project_id=None,
            title=labels.t(title_key, state=labels.t(f"health_{new}"), name=name), body=detail if detail is not None else "",
            evidence=None, needs_processing=False, undo=None, card_id=None, category=None,
        )
    if not was_ok and new == "ok":
        db.insert_record(
            at=at, author="system", source="hub", kind="log", tier="log", item_id=None, project_id=None,
            title=labels.t(title_key, state=labels.t("health_recovered"), name=name), body="", evidence=None, needs_processing=False, undo=None, card_id=None, category=None,
        )
    return None
