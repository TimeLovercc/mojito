"""In-process watchdog: stale sources → one interrupt per outage, stuck jobs → queued,
expired active plans → closed, scheduled jobs (morning/evening, weekly summary, draft review
on the plan's last day) → queued at their local time (MOJITO_TIMEZONE)."""

import asyncio
import json
import logging
import os
from datetime import date, datetime, time, timedelta

from . import db, labels
from .push import push

INTERVAL_S = 60
JOB_TIMEOUT = timedelta(minutes=30)
# Daily jobs are enqueued only within this window after their time, so a hub that was
# down at that moment does not catch up later.
DAILY_WINDOW = timedelta(minutes=10)
DAILY = (("morning_brief", "morning_at"), ("evening_prompt", "evening_at"))
WEEKLY_AT = "20:00"  # weekly_summary and feed_weekly, Sundays, local time
SYNC_EVERY = timedelta(minutes=30)
# Subscriptions run daily at their own `at` (MOJITO_TIMEZONE); watch also every
# config.every_hours from `at` (api.md 信息流改成报告).
SUBSCRIPTION_JOB = {"brief": "feed_brief", "watch": "feed_watch", "mail": "feed_mail"}

log = logging.getLogger("mojito_hub.watchdog")


def run_once() -> None:
    at = db.now()
    alerts = []
    with db.conn:
        db.close_active_plans(at, expired_only=True)
        db.conn.execute(
            "UPDATE jobs SET status = 'queued', started_at = NULL"
            " WHERE status = 'running' AND started_at < ?",
            (db.ts(at - JOB_TIMEOUT),),
        )
        for row in db.all_("SELECT * FROM sources WHERE alarmed = 0"):
            src = db.source_of(row, at)
            if src.alive:
                continue
            db.conn.execute("UPDATE sources SET alarmed = 1 WHERE name = ?", (src.name,))
            alerts.append(db.insert_record(
                at=at, author="system", source="hub", kind="alert", tier="interrupt", item_id=None,
                project_id=None,
                title=labels.t("source_lost", name=src.name, s=src.expected_interval_s),
                body=labels.t("source_lost_body", t=labels.short_time(db.ts(src.last_seen_at)), s=src.expected_interval_s),
                evidence=None, needs_processing=False, undo=None, card_id=None, category=None, smoke=False,
            ))
    for r in alerts:
        push(r)
    enqueue_scheduled(at)


def _due(day: date, hhmm: str, at: datetime) -> bool:
    due = datetime.combine(day, time.fromisoformat(hhmm), db.DAY_TZ)
    return due <= at < due + DAILY_WINDOW


def _claim(kind: str, key: str) -> bool:
    """Record that `kind` ran for `key` (a local date, a watch run time, or a plan id for draft_review)."""
    if db.one("SELECT 1 FROM schedule_runs WHERE kind = ? AND day = ?", kind, key):
        return False
    db.conn.execute("INSERT INTO schedule_runs (kind, day) VALUES (?, ?)", (kind, key))
    return True


def enqueue_scheduled(at: datetime) -> None:
    settings = db.settings_of(db.one("SELECT * FROM settings WHERE id = 1"))
    today = db.local_today(at)
    reminders = []
    with db.conn:
        for kind, field in DAILY:
            if kind == "evening_prompt" and not settings.evening_enabled:
                continue
            if _due(today, getattr(settings, field), at) and _claim(kind, today.isoformat()):
                db.insert_job(kind=kind, runner="server", record_id=None, payload=None, at=at)
                log.info("enqueued %s for %s", kind, today)
        for sub in db.all_("SELECT * FROM subscriptions WHERE enabled = 1"):
            kind = SUBSCRIPTION_JOB[sub["kind"]]
            for key in _subscription_runs_due(sub, today, at):
                # Claimed even when skipped, so a run of the same kind still going does not
                # get a second one later in the window.
                if _claim(kind, key) and not _active(kind):
                    db.insert_job(kind=kind, runner="mac", record_id=None, payload=None, at=at)
                    log.info("enqueued %s for %s", kind, key)
        if today.weekday() == 6 and _due(today, WEEKLY_AT, at):
            for kind in ("weekly_summary", "feed_weekly"):
                if _claim(kind, today.isoformat()):
                    db.insert_job(kind=kind, runner="mac", record_id=None, payload=None, at=at)
                    log.info("enqueued %s for %s", kind, today)
        plan = db.one("SELECT * FROM plans WHERE status = 'active'")
        if (plan is not None and plan["end"] == today.isoformat()
                and _due(today, settings.evening_at, at) and _claim("draft_review", plan["id"])):
            status = db.review_status(plan["id"])
            if status != "done":
                # An early review (POST /jobs draft_review) already drafted it: only remind.
                if status == "none":
                    db.insert_job(kind="draft_review", runner="mac", record_id=None, payload=None, at=at)
                reminders.append(db.insert_record(
                    at=at, author="system", source="hub", kind="alert", tier="interrupt", item_id=None,
                    project_id=None,
                    title=labels.t("review_due"),
                    body=labels.t("review_due_body", start=labels.short_date(plan["start"]), end=labels.short_date(plan["end"])),
                    evidence=None, needs_processing=False, undo=None, card_id=None, category=None, smoke=False,
                ))
    for r in reminders:
        push(r)
    enqueue_sync_projects(at)


def _subscription_runs_due(sub, today: date, at: datetime) -> list[str]:
    """Claim keys of the runs of a subscription due now: the NY date for daily kinds; for
    watch, the UTC time of each run at `at` + k·every_hours (k ≥ 0, within that day's 24 h,
    wall clock), counted from yesterday's and today's `at`."""
    if sub["kind"] != "watch":
        return [today.isoformat()] if _due(today, sub["at"], at) else []
    every = json.loads(sub["config"])["every_hours"]
    keys = []
    for day in (today - timedelta(days=1), today):
        start = datetime.combine(day, time.fromisoformat(sub["at"]), db.DAY_TZ)
        for k in range(-(-24 // every)):
            run = start + timedelta(hours=k * every)
            if run <= at < run + DAILY_WINDOW:
                keys.append(db.ts(run))
    return keys


def _active(kind: str) -> bool:
    """A job of this kind is already queued or running."""
    return db.one("SELECT 1 FROM jobs WHERE kind = ? AND status IN ('queued', 'running')", kind) is not None


def enqueue_sync_projects(at: datetime) -> None:
    """Every SYNC_EVERY, unless a sync_projects job is already queued or running."""
    if _active("sync_projects"):
        return
    last = db.one("SELECT MAX(requested_at) AS at FROM jobs WHERE kind = 'sync_projects'")["at"]
    if last is not None and db.parse(last) > at - SYNC_EVERY:
        return
    with db.conn:
        db.insert_job(kind="sync_projects", runner="mac", record_id=None, payload=None, at=at)


async def loop() -> None:
    while True:
        await asyncio.sleep(INTERVAL_S)
        run_once()


def die_on_crash(task: asyncio.Task) -> None:
    """A dead watchdog must not go unnoticed: log and exit so systemd restarts the hub."""
    if task.cancelled():
        return
    log.error("watchdog crashed", exc_info=task.exception())
    os._exit(1)
