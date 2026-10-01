"""SQLite storage. All datetimes are stored as UTC ISO-8601 with second precision so
string comparison equals time comparison. All access happens on the event-loop thread."""

import json
import re
import sqlite3
import uuid
from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo

from . import config, labels
from .models import (
    Attachment, Card, Draft, Event, Feedback, FeedbackMessage, Goal, Item, ItemIn, Job, Plan, Project, ProjectCreateIn, Record, Review,
    SeedSettings, Settings, Snapshot, Source, Subscription, TasteNote,
)

DAY_TZ = ZoneInfo(config.TIMEZONE)  # api.md: day-based checks use dates in the owner's timezone (MOJITO_TIMEZONE)

SCHEMA = """
CREATE TABLE IF NOT EXISTS goals (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, status TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS plans (
    id TEXT PRIMARY KEY, start TEXT NOT NULL, "end" TEXT NOT NULL,
    goal_ids TEXT NOT NULL, item_ids TEXT NOT NULL, status TEXT NOT NULL,
    created_at TEXT, closed_at TEXT);
CREATE TABLE IF NOT EXISTS items (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, category TEXT NOT NULL, status TEXT NOT NULL,
    next_step TEXT NOT NULL, next_at TEXT, owner TEXT NOT NULL, done_definition TEXT NOT NULL,
    goal_id TEXT, progress TEXT, updated_at TEXT NOT NULL, updated_by TEXT NOT NULL,
    project_id TEXT);
CREATE TABLE IF NOT EXISTS records (
    seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, at TEXT NOT NULL,
    author TEXT NOT NULL, source TEXT NOT NULL, kind TEXT NOT NULL, tier TEXT NOT NULL,
    item_id TEXT, title TEXT NOT NULL, body TEXT NOT NULL, evidence TEXT,
    needs_processing INTEGER NOT NULL, undo TEXT, undone_at TEXT, project_id TEXT,
    card_id TEXT, feedback_id TEXT);
CREATE INDEX IF NOT EXISTS records_order ON records (at, seq);
CREATE INDEX IF NOT EXISTS records_item ON records (item_id);
CREATE TABLE IF NOT EXISTS sources (
    name TEXT PRIMARY KEY, expected_interval_s INTEGER NOT NULL, last_seen_at TEXT,
    alarmed INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS jobs (
    seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, kind TEXT NOT NULL,
    runner TEXT NOT NULL, record_id TEXT, status TEXT NOT NULL, requested_at TEXT, started_at TEXT,
    finished_at TEXT, error TEXT);
CREATE TABLE IF NOT EXISTS devices (fcm_token TEXT PRIMARY KEY, registered_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS reads (id INTEGER PRIMARY KEY CHECK (id = 1), record_id TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS settings (
    id INTEGER PRIMARY KEY CHECK (id = 1), morning_at TEXT NOT NULL, evening_at TEXT NOT NULL,
    evening_enabled INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS schedule_runs (
    kind TEXT NOT NULL, day TEXT NOT NULL, PRIMARY KEY (kind, day));
CREATE TABLE IF NOT EXISTS calendar_events (
    uid TEXT NOT NULL, start TEXT NOT NULL, "end" TEXT NOT NULL, all_day INTEGER NOT NULL,
    title TEXT NOT NULL, location TEXT, read_only INTEGER NOT NULL, feed TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS calendar_start ON calendar_events (start);
CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, area TEXT NOT NULL, status TEXT NOT NULL,
    repo_path TEXT, goal_id TEXT, summary TEXT, summary_evidence TEXT, summary_at TEXT);
CREATE TABLE IF NOT EXISTS project_snapshots (project_id TEXT PRIMARY KEY, snapshot TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS usage (
    seq INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, kind TEXT NOT NULL,
    name TEXT NOT NULL, detail TEXT);
CREATE INDEX IF NOT EXISTS usage_at ON usage (at);
CREATE TABLE IF NOT EXISTS auth_status (
    name TEXT PRIMARY KEY, ok INTEGER NOT NULL, detail TEXT, checked_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS attachments (
    id TEXT PRIMARY KEY, content_type TEXT NOT NULL, bytes INTEGER NOT NULL,
    width INTEGER NOT NULL, height INTEGER NOT NULL, created_at TEXT NOT NULL,
    record_id TEXT, message_id TEXT);
CREATE INDEX IF NOT EXISTS attachments_record ON attachments (record_id);
CREATE TABLE IF NOT EXISTS cards (
    seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, at TEXT NOT NULL,
    source TEXT NOT NULL, origin TEXT NOT NULL, kind TEXT NOT NULL, project_id TEXT,
    title TEXT NOT NULL, summary TEXT NOT NULL, link TEXT, dedupe_key TEXT NOT NULL,
    status TEXT NOT NULL, item_id TEXT, UNIQUE (origin, dedupe_key));
CREATE INDEX IF NOT EXISTS cards_order ON cards (at, seq);
CREATE TABLE IF NOT EXISTS card_reads (id INTEGER PRIMARY KEY CHECK (id = 1), card_id TEXT NOT NULL);
-- Every field change of an item (PUT /items, decisions, undo), so an item undo can tell
-- whether the same field changed again afterwards.
CREATE TABLE IF NOT EXISTS item_changes (
    seq INTEGER PRIMARY KEY AUTOINCREMENT, item_id TEXT NOT NULL, field TEXT NOT NULL, at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS item_changes_item ON item_changes (item_id, field);
-- Same for goals, plans, projects, settings and note links (changes.py).
CREATE TABLE IF NOT EXISTS entity_changes (
    seq INTEGER PRIMARY KEY AUTOINCREMENT, entity TEXT NOT NULL, entity_id TEXT NOT NULL,
    field TEXT NOT NULL, at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS entity_changes_key ON entity_changes (entity, entity_id, field);
-- For records carrying a hub-side undo: the last item_changes.seq (item) or
-- entity_changes.seq (other types) when the record was written.
CREATE TABLE IF NOT EXISTS undo_marks (record_id TEXT PRIMARY KEY, change_seq INTEGER NOT NULL);
-- Attachments of a feedback hang on its kind=feedback record (record_id); those of a thread
-- message on the message (attachments.message_id).
CREATE TABLE IF NOT EXISTS feedback_messages (
    seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, feedback_id TEXT NOT NULL,
    at TEXT NOT NULL, author TEXT NOT NULL, body TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS feedback_messages_thread ON feedback_messages (feedback_id, seq);
CREATE TABLE IF NOT EXISTS feedback (
    seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, at TEXT NOT NULL,
    body TEXT NOT NULL, context TEXT NOT NULL, status TEXT NOT NULL, ship_mode TEXT, summary TEXT,
    updated_at TEXT NOT NULL, record_id TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS taste_notes (
    seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, at TEXT NOT NULL, text TEXT NOT NULL,
    source TEXT NOT NULL, retired_at TEXT);
CREATE TABLE IF NOT EXISTS subscriptions (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL, at TEXT NOT NULL,
    enabled INTEGER NOT NULL, config TEXT NOT NULL, last_run_at TEXT, last_result TEXT, health TEXT);
CREATE TABLE IF NOT EXISTS webpush_subscriptions (
    endpoint TEXT PRIMARY KEY, p256dh TEXT NOT NULL, auth TEXT NOT NULL,
    token_ref TEXT NOT NULL, user_agent TEXT NOT NULL, registered_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS drafts (
    id TEXT PRIMARY KEY, at TEXT NOT NULL, source TEXT NOT NULL, channel TEXT NOT NULL,
    "to" TEXT NOT NULL, subject TEXT, body TEXT NOT NULL, item_id TEXT, status TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS reviews (
    plan_id TEXT PRIMARY KEY, created_at TEXT NOT NULL, summary TEXT NOT NULL,
    completed_item_ids TEXT NOT NULL, missed_item_ids TEXT NOT NULL, patterns TEXT NOT NULL,
    user_note TEXT, status TEXT NOT NULL);
"""

conn = sqlite3.connect(config.DB_PATH)
conn.row_factory = sqlite3.Row
conn.execute("PRAGMA journal_mode=WAL")


def now() -> datetime:
    return datetime.now(UTC).replace(microsecond=0)


def ts(dt: datetime) -> str:
    if dt.tzinfo is None:
        raise ValueError(f"naive datetime {dt!r}")
    return dt.astimezone(UTC).isoformat(timespec="seconds")


def ts_or_null(dt: datetime | None) -> str | None:
    return None if dt is None else ts(dt)


def parse(s: str | None) -> datetime | None:
    return None if s is None else datetime.fromisoformat(s)


def new_id(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:12]}"


def init() -> None:
    conn.executescript(SCHEMA)
    migrate()


def migrate() -> None:
    """In-place upgrades for databases created by earlier versions."""
    job_cols = {r["name"] for r in conn.execute("PRAGMA table_info(jobs)")}
    if "runner" not in job_cols:
        with conn:
            # v1 only had mac-side kinds (refresh / process_note / draft_plan).
            conn.execute("ALTER TABLE jobs ADD COLUMN runner TEXT")
            conn.execute("UPDATE jobs SET runner = 'mac'")
    settings_cols = {r["name"] for r in conn.execute("PRAGMA table_info(settings)")}
    if "evening_enabled" not in settings_cols:
        with conn:
            conn.execute("ALTER TABLE settings ADD COLUMN evening_enabled INTEGER")
            conn.execute("UPDATE settings SET evening_enabled = 1")
    record_cols = {r["name"] for r in conn.execute("PRAGMA table_info(records)")}
    if "undo" not in record_cols:
        with conn:
            conn.execute("ALTER TABLE records ADD COLUMN undo TEXT")
            conn.execute("ALTER TABLE records ADD COLUMN undone_at TEXT")
    for table in ("items", "records"):
        cols = {r["name"] for r in conn.execute(f"PRAGMA table_info({table})")}
        if "project_id" not in cols:
            with conn:
                conn.execute(f"ALTER TABLE {table} ADD COLUMN project_id TEXT")
    conn.execute("CREATE INDEX IF NOT EXISTS records_project ON records (project_id, at)")
    for table, col in (("plans", "revises"), ("records", "card_id"), ("records", "feedback_id"),
                       ("attachments", "message_id"), ("sources", "health"), ("sources", "health_detail"),
                       ("sources", "health_at"), ("records", "hidden_at"), ("jobs", "payload"),
                       ("cards", "image_attachment_id"), ("records", "category"), ("settings", "notify"),
                       ("settings", "language"), ("cards", "body")):
        cols = {r["name"] for r in conn.execute(f"PRAGMA table_info({table})")}
        if col not in cols:
            with conn:
                conn.execute(f"ALTER TABLE {table} ADD COLUMN {col} TEXT")
    if "smoke" not in {r["name"] for r in conn.execute("PRAGMA table_info(records)")}:
        with conn:
            # api.md 冒烟标记: records before it are real.
            conn.execute("ALTER TABLE records ADD COLUMN smoke INTEGER")
            conn.execute("UPDATE records SET smoke = 0")
    if "read_only" not in {r["name"] for r in conn.execute("PRAGMA table_info(calendar_events)")}:
        with conn:
            # api.md 订阅日历: events before it all came from the main calendar.
            conn.execute("ALTER TABLE calendar_events ADD COLUMN read_only INTEGER")
            conn.execute("ALTER TABLE calendar_events ADD COLUMN feed TEXT")
            conn.execute("UPDATE calendar_events SET read_only = 0, feed = ?", (config.token_ref(config.ICAL_URL),))
    if one("SELECT 1 FROM subscriptions LIMIT 1") is None:
        with conn:
            # api.md 删日程、订阅… as changed by 信息流改成报告: the three initial subscriptions.
            conn.executemany(
                "INSERT INTO subscriptions (id, name, kind, at, enabled, config, last_run_at, last_result, health)"
                " VALUES (?, ?, ?, ?, 1, ?, NULL, NULL, NULL)",
                [("brief", "每日简报", "brief", "07:00", "{}"),
                 ("mail", "每日邮件", "mail", "07:30", "{}"), WATCH_SUBSCRIPTION],
            )
    with conn:
        # api.md 通知设置: every category on for settings that predate `notify`.
        conn.execute("UPDATE settings SET notify = ? WHERE notify IS NULL", (json.dumps(NOTIFY_ALL_ON),))
        # api.md 界面语言: settings that predate `language` are Chinese.
        conn.execute("UPDATE settings SET language = 'zh' WHERE language IS NULL")
    # One-time data migrations, tracked in PRAGMA user_version.
    if conn.execute("PRAGMA user_version").fetchone()[0] < 1:
        with conn:
            # The timeline page was logged as view "feed"; "feed" now means the card feed.
            conn.execute("UPDATE usage SET name = 'timeline' WHERE kind = 'view' AND name = 'feed'")
        conn.execute("PRAGMA user_version = 1")
    if conn.execute("PRAGMA user_version").fetchone()[0] < 2:
        with conn:
            # Pushed records written before `category` existed get the inferred category.
            for r in all_("SELECT id, tier, source, kind, title FROM records WHERE tier != 'log' AND category IS NULL"):
                conn.execute("UPDATE records SET category = ? WHERE id = ?",
                             (infer_category(tier=r["tier"], source=r["source"], kind=r["kind"], title=r["title"]),
                              r["id"]))
        conn.execute("PRAGMA user_version = 2")
    if conn.execute("PRAGMA user_version").fetchone()[0] < 3:
        with conn:
            migrate_feed_to_reports()
        conn.execute("PRAGMA user_version = 3")


# api.md 信息流改成报告: the lab watch subscription (id, name, kind, at, config).
WATCH_SUBSCRIPTION = ("watch", "实验室动态", "watch", "08:00", json.dumps(
    {"labs": ["OpenAI", "Anthropic", "DeepMind/Gemini", "DeepSeek", "Qwen", "Kimi"], "every_hours": 8}, ensure_ascii=False))


def migrate_feed_to_reports() -> None:
    """api.md 信息流改成报告: papers → brief (keeps at/enabled), watch created; notify gains news.
    Undo of earlier changes to papers is dropped, since that subscription no longer exists in that shape.
    A database created with the new initial subscriptions has no papers row."""
    papers = one("SELECT * FROM subscriptions WHERE id = 'papers'")
    if papers is not None:
        conn.execute(
            "UPDATE subscriptions SET id = 'brief', name = '每日简报', kind = 'brief', config = '{}',"
            " last_run_at = NULL, last_result = NULL, health = NULL WHERE id = 'papers'")
        conn.execute(
            "INSERT INTO subscriptions (id, name, kind, at, enabled, config, last_run_at, last_result, health)"
            " VALUES (?, ?, ?, ?, 1, ?, NULL, NULL, NULL)", WATCH_SUBSCRIPTION)
        for r in all_("SELECT id, undo FROM records WHERE undo IS NOT NULL"):
            undo = json.loads(r["undo"])
            if undo["type"] == "subscription" and undo["subscription_id"] == "papers":
                conn.execute("UPDATE records SET undo = NULL WHERE id = ?", (r["id"],))
    for r in all_("SELECT notify FROM settings WHERE id = 1"):
        notify = json.loads(r["notify"])
        if "news" not in notify:
            conn.execute("UPDATE settings SET notify = ? WHERE id = 1", (json.dumps({**notify, "news": True}),))


def local_day_bounds(day: date) -> tuple[str, str]:
    """[00:00, next 00:00) of a local calendar day, as stored UTC strings."""
    start = datetime.combine(day, datetime.min.time(), DAY_TZ)
    end = datetime.combine(day + timedelta(days=1), datetime.min.time(), DAY_TZ)
    return ts(start), ts(end)


def local_today(at: datetime) -> date:
    return at.astimezone(DAY_TZ).date()


# ---- row → object ----

def goal_of(row: sqlite3.Row) -> Goal:
    return Goal(id=row["id"], title=row["title"], status=row["status"])


def plan_of(row: sqlite3.Row) -> Plan:
    return Plan(
        id=row["id"], start=date.fromisoformat(row["start"]), end=date.fromisoformat(row["end"]),
        goal_ids=json.loads(row["goal_ids"]), item_ids=json.loads(row["item_ids"]),
        status=row["status"], created_at=parse(row["created_at"]), closed_at=parse(row["closed_at"]),
        review_status=review_status(row["id"]), revises=row["revises"],
    )


def review_status(plan_id: str) -> str:
    row = one("SELECT status FROM reviews WHERE plan_id = ?", plan_id)
    return "none" if row is None else row["status"]


def review_of(row: sqlite3.Row) -> Review:
    return Review(
        plan_id=row["plan_id"], created_at=parse(row["created_at"]), summary=row["summary"],
        completed_item_ids=json.loads(row["completed_item_ids"]),
        missed_item_ids=json.loads(row["missed_item_ids"]), patterns=json.loads(row["patterns"]),
        user_note=row["user_note"], status=row["status"],
    )


def draft_of(row: sqlite3.Row) -> Draft:
    return Draft(
        id=row["id"], at=parse(row["at"]), source=row["source"], channel=row["channel"],
        to=row["to"], subject=row["subject"], body=row["body"], item_id=row["item_id"],
        status=row["status"],
    )


def item_of(row: sqlite3.Row, at: datetime) -> Item:
    next_at = parse(row["next_at"])
    return Item(
        id=row["id"], title=row["title"], category=row["category"], status=row["status"],
        forgotten=item_lateness(row["status"], next_at, parse(row["updated_at"]), at) == "forgotten",
        next_step=row["next_step"], next_at=next_at, owner=row["owner"],
        done_definition=row["done_definition"], goal_id=row["goal_id"], project_id=row["project_id"],
        progress=None if row["progress"] is None else json.loads(row["progress"]),
        updated_at=parse(row["updated_at"]), updated_by=row["updated_by"],
    )


OPEN_STATUSES = ("active", "waiting_you", "scheduled")
RECENTLY_TOUCHED = timedelta(days=7)


def item_lateness(status: str, next_at: datetime | None, updated_at: datetime, at: datetime) -> str | None:
    """api.md 准绳落地 for open items: next_at null, or past (before 00:00 today, local) and
    untouched for 7 days → "forgotten" (red); past but touched within 7 days → "overdue" (amber)."""
    if status not in OPEN_STATUSES:
        return None
    if next_at is None:
        return "forgotten"
    if next_at >= parse(local_day_bounds(local_today(at))[0]):
        return None
    return "overdue" if updated_at >= at - RECENTLY_TOUCHED else "forgotten"


def record_of(row: sqlite3.Row) -> Record:
    return Record(
        id=row["id"], at=parse(row["at"]), author=row["author"], source=row["source"],
        kind=row["kind"], tier=row["tier"], item_id=row["item_id"], project_id=row["project_id"],
        title=row["title"],
        body=row["body"], evidence=row["evidence"], needs_processing=bool(row["needs_processing"]),
        undo=None if row["undo"] is None else json.loads(row["undo"]),
        undone_at=parse(row["undone_at"]),
        attachments=[attachment_of(a) for a in all_("SELECT * FROM attachments WHERE record_id = ? ORDER BY rowid",
                                                     row["id"])],
        card_id=row["card_id"], feedback_id=row["feedback_id"], hidden_at=parse(row["hidden_at"]),
        category=row["category"], smoke=bool(row["smoke"]),
    )


def feedback_message_of(row: sqlite3.Row) -> FeedbackMessage:
    return FeedbackMessage(
        id=row["id"], feedback_id=row["feedback_id"], at=parse(row["at"]), author=row["author"], body=row["body"],
        attachments=[attachment_of(a) for a in all_("SELECT * FROM attachments WHERE message_id = ? ORDER BY rowid",
                                                     row["id"])],
    )


def feedback_of(row: sqlite3.Row) -> Feedback:
    return Feedback(
        id=row["id"], at=parse(row["at"]), body=row["body"],
        attachments=[attachment_of(a) for a in all_("SELECT * FROM attachments WHERE record_id = ? ORDER BY rowid",
                                                     row["record_id"])],
        context=json.loads(row["context"]), status=row["status"], ship_mode=row["ship_mode"],
        summary=row["summary"], updated_at=parse(row["updated_at"]),
    )


def taste_note_of(row: sqlite3.Row) -> TasteNote:
    return TasteNote(id=row["id"], at=parse(row["at"]), text=row["text"], source=row["source"])


def card_of(row: sqlite3.Row) -> Card:
    return Card(
        id=row["id"], at=parse(row["at"]), source=row["source"], origin=row["origin"], kind=row["kind"],
        project_id=row["project_id"], title=row["title"], summary=row["summary"], body=row["body"], link=row["link"],
        dedupe_key=row["dedupe_key"], status=row["status"], item_id=row["item_id"],
        image_attachment_id=row["image_attachment_id"],
    )


def subscription_of(row: sqlite3.Row) -> Subscription:
    return Subscription(
        id=row["id"], name=labels.name("subscription", row["kind"]), kind=row["kind"], at=row["at"], enabled=bool(row["enabled"]),
        config=json.loads(row["config"]), last_run_at=parse(row["last_run_at"]), last_result=row["last_result"],
        health=row["health"],
    )


def attachment_of(row: sqlite3.Row) -> Attachment:
    return Attachment(id=row["id"], content_type=row["content_type"], bytes=row["bytes"],
                      width=row["width"], height=row["height"], created_at=parse(row["created_at"]))


# The maintainer session counts as lost only after twice its interval (api.md 准绳落地).
STALE_FACTOR = {"maintainer": 2}


def source_of(row: sqlite3.Row, at: datetime) -> Source:
    last = parse(row["last_seen_at"])
    factor = STALE_FACTOR[row["name"]] if row["name"] in STALE_FACTOR else 1
    alive = last is not None and at - last <= timedelta(seconds=row["expected_interval_s"] * factor)
    return Source(name=row["name"], expected_interval_s=row["expected_interval_s"],
                  last_seen_at=last, alive=alive, health=row["health"], health_detail=row["health_detail"],
                  health_at=parse(row["health_at"]))


def job_of(row: sqlite3.Row) -> Job:
    return Job(
        id=row["id"], kind=row["kind"], runner=row["runner"], record_id=row["record_id"],
        payload=None if row["payload"] is None else json.loads(row["payload"]), status=row["status"],
        requested_at=parse(row["requested_at"]), started_at=parse(row["started_at"]),
        finished_at=parse(row["finished_at"]), error=row["error"],
    )


def event_of(row: sqlite3.Row) -> Event:
    return Event(uid=row["uid"], start=parse(row["start"]), end=parse(row["end"]),
                 all_day=bool(row["all_day"]), title=row["title"], location=row["location"],
                 read_only=bool(row["read_only"]))


NOTIFY_ALL_ON = {"brief": True, "chat": True, "alert": True, "feedback": True, "release": True, "jobs": True,
                 "news": True}


def settings_of(row: sqlite3.Row) -> Settings:
    return Settings(morning_at=row["morning_at"], evening_at=row["evening_at"],
                    evening_enabled=bool(row["evening_enabled"]), notify=json.loads(row["notify"]),
                    language=row["language"])


def events_between(start: str, end: str) -> list[Event]:
    """Events overlapping [start, end) (stored UTC strings), by start. Zero-length events
    count when they start inside the range."""
    rows = conn.execute(
        'SELECT * FROM calendar_events WHERE start < ? AND ("end" > ? OR start >= ?)'
        " ORDER BY start, title",
        (end, start, start),
    ).fetchall()
    return [event_of(r) for r in rows]


STALE_AFTER = timedelta(days=7)
OPEN_ITEM_STATUSES = ("active", "waiting_you", "scheduled")
ORCA_WORKSPACE = re.compile(r"/orca/workspaces/([^/]+)(?:/|$)")


def snapshot_of(project_id: str) -> Snapshot | None:
    row = one("SELECT snapshot FROM project_snapshots WHERE project_id = ?", project_id)
    return None if row is None else Snapshot.model_validate_json(row["snapshot"])


def project_of(row: sqlite3.Row, at: datetime) -> Project:
    """last_activity_at = newest of the project's records and the activity inside its
    snapshot (worktree activity, commits); the snapshot's own taken_at does not count."""
    times = []
    latest_record = one("SELECT MAX(at) AS at FROM records WHERE project_id = ?", row["id"])["at"]
    if latest_record is not None:
        times.append(parse(latest_record))
    snap = snapshot_of(row["id"])
    if snap is not None:
        times += [w.last_activity_at for w in snap.worktrees if w.last_activity_at is not None]
        times += [c.at for c in snap.commits]
    last = max(times) if times else None
    open_items = one(
        f"SELECT COUNT(*) AS n FROM items WHERE project_id = ? AND status IN {OPEN_ITEM_STATUSES}",
        row["id"],
    )["n"]
    return Project(
        id=row["id"], title=row["title"], area=row["area"], status=row["status"],
        repo_path=row["repo_path"], goal_id=row["goal_id"], summary=row["summary"],
        summary_evidence=row["summary_evidence"], summary_at=parse(row["summary_at"]),
        last_activity_at=last,
        stale=row["status"] == "active" and (last is None or last < at - STALE_AFTER),
        open_items=open_items,
    )


def project_for_repo_path(path: str) -> str | None:
    """Longest project repo_path that is `path` or a parent of it; otherwise, for Orca
    worktrees (…/orca/workspaces/<repo>/…), the project whose repo_path ends in <repo>."""
    rows = all_("SELECT id, repo_path FROM projects WHERE repo_path IS NOT NULL")
    stripped = path.rstrip("/")
    hits = [r for r in rows if stripped == r["repo_path"].rstrip("/")
            or stripped.startswith(r["repo_path"].rstrip("/") + "/")]
    if hits:
        return max(hits, key=lambda r: len(r["repo_path"]))["id"]
    m = ORCA_WORKSPACE.search(path)
    if m is None:
        return None
    by_name = [r for r in rows if r["repo_path"].rstrip("/").rsplit("/", 1)[-1] == m.group(1)]
    return by_name[0]["id"] if len(by_name) == 1 else None


def insert_project(p: ProjectCreateIn, status: str) -> None:
    conn.execute(
        "INSERT INTO projects (id, title, area, status, repo_path, goal_id, summary,"
        " summary_evidence, summary_at) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, NULL)",
        (p.id, p.title, p.area, status, p.repo_path, p.goal_id),
    )


# ---- lookups (None when absent; callers decide 404/422) ----

def one(sql: str, *args) -> sqlite3.Row | None:
    return conn.execute(sql, args).fetchone()


def all_(sql: str, *args) -> list[sqlite3.Row]:
    return conn.execute(sql, args).fetchall()


def exists(table: str, id_: str) -> bool:
    return one(f"SELECT 1 FROM {table} WHERE id = ?", id_) is not None


# ---- writes (no commit; callers wrap in `with conn:`) ----

def insert_record(*, at: datetime, author: str, source: str, kind: str, tier: str,
                  item_id: str | None, project_id: str | None, title: str, body: str,
                  evidence: str | None, needs_processing: bool, undo: dict | None,
                  card_id: str | None, category: str | None, smoke: bool) -> Record:
    """A record on an item inherits the item's project; `project_id` applies only without one.
    Pushed tiers get a notification category: `category` if given, else inferred."""
    if item_id is not None:
        project_id = one("SELECT project_id FROM items WHERE id = ?", item_id)["project_id"]
    if tier == "log":
        category = None
    elif category is None:
        category = infer_category(tier=tier, source=source, kind=kind, title=title)
    rid = new_id("r")
    conn.execute(
        "INSERT INTO records (id, at, author, source, kind, tier, item_id, project_id, title, body,"
        " evidence, needs_processing, undo, undone_at, card_id, category, smoke)"
        " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)",
        (rid, ts(at), author, source, kind, tier, item_id, project_id, title, body, evidence,
         int(needs_processing), None if undo is None else json.dumps(undo), card_id, category, int(smoke)),
    )
    return record_of(one("SELECT * FROM records WHERE id = ?", rid))


ITEM_FIELDS = ("title", "category", "status", "next_step", "next_at", "owner", "goal_id",
               "project_id", "progress")


def log_item_changes(item_id: str, old: sqlite3.Row | None, at: datetime) -> None:
    """Record which fields of an existing item differ from `old` (call after the write)."""
    if old is None:
        return
    new = one("SELECT * FROM items WHERE id = ?", item_id)
    conn.executemany("INSERT INTO item_changes (item_id, field, at) VALUES (?, ?, ?)",
                     [(item_id, f, ts(at)) for f in ITEM_FIELDS if old[f] != new[f]])


def last_item_change_seq() -> int:
    return one("SELECT COALESCE(MAX(seq), 0) AS s FROM item_changes")["s"]


RELEASE_PREFIXES = ("app 已更新", "服务器已更新", "新安装包")


def infer_category(*, tier: str, source: str, kind: str, title: str) -> str:
    """api.md 通知设置: the category of a pushed record nobody named."""
    if tier == "interrupt":
        return "alert"
    if source == "maintainer" or kind == "feedback":
        return "feedback"
    if source == "cards" and title.startswith(RELEASE_PREFIXES):
        return "release"
    if kind == "chat":
        return "chat"
    return "jobs"


def insert_job(*, kind: str, runner: str, record_id: str | None, payload: dict | None, at: datetime) -> Job:
    jid = new_id("j")
    conn.execute(
        "INSERT INTO jobs (id, kind, runner, record_id, payload, status, requested_at, started_at,"
        " finished_at, error) VALUES (?, ?, ?, ?, ?, 'queued', ?, NULL, NULL, NULL)",
        (jid, kind, runner, record_id, None if payload is None else json.dumps(payload), ts(at)),
    )
    return job_of(one("SELECT * FROM jobs WHERE id = ?", jid))


def heartbeat(name: str, expected_interval_s: int, at: datetime) -> None:
    conn.execute(
        "INSERT INTO sources (name, expected_interval_s, last_seen_at, alarmed) VALUES (?, ?, ?, 0)"
        " ON CONFLICT (name) DO UPDATE SET expected_interval_s = excluded.expected_interval_s,"
        " last_seen_at = excluded.last_seen_at, alarmed = 0",
        (name, expected_interval_s, ts(at)),
    )


def close_active_plans(at: datetime, *, expired_only: bool) -> None:
    sql = "UPDATE plans SET status = 'closed', closed_at = ? WHERE status = 'active'"
    if expired_only:
        conn.execute(sql + ' AND "end" < ?', (ts(at), at.astimezone(DAY_TZ).date().isoformat()))
    else:
        conn.execute(sql, (ts(at),))


# ---- seed ----

def drop_orphan_webpush(app_token_refs: set[str]) -> int:
    """Subscriptions of app tokens that no longer exist (revoked, then the hub restarted)."""
    with conn:
        rows = all_("SELECT endpoint, token_ref FROM webpush_subscriptions")
        orphans = [(r["endpoint"],) for r in rows if r["token_ref"] not in app_token_refs]
        conn.executemany("DELETE FROM webpush_subscriptions WHERE endpoint = ?", orphans)
    return len(orphans)


def seed_if_empty(path: str) -> bool:
    if one("SELECT 1 FROM goals LIMIT 1") is not None:
        return False
    with open(path) as f:
        seed = json.load(f)
    with conn:
        for g in seed["goals"]:
            Goal.model_validate(g)
            conn.execute("INSERT INTO goals (id, title, status) VALUES (?, ?, ?)",
                         (g["id"], g["title"], g["status"]))
        for p in seed["plans"]:
            Plan.model_validate({**p, "review_status": "none", "revises": None})  # no review/revision yet
            conn.execute(
                'INSERT INTO plans (id, start, "end", goal_ids, item_ids, status, created_at, closed_at)'
                " VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (p["id"], date.fromisoformat(p["start"]).isoformat(),
                 date.fromisoformat(p["end"]).isoformat(), json.dumps(p["goal_ids"]),
                 json.dumps(p["item_ids"]), p["status"], ts_or_null(parse(p["created_at"])),
                 ts_or_null(parse(p["closed_at"]))),
            )
        for i in seed["items"]:
            # project_id is assigned later from seed["item_projects"] (projects_seed_if_empty).
            ItemIn.model_validate({**{k: v for k, v in i.items() if k not in ("id", "updated_at", "updated_by")},
                                   "project_id": None})
            conn.execute(
                "INSERT INTO items (id, title, category, status, next_step, next_at, owner,"
                " done_definition, goal_id, progress, updated_at, updated_by)"
                " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (i["id"], i["title"], i["category"], i["status"], i["next_step"],
                 ts_or_null(parse(i["next_at"])), i["owner"], i["done_definition"], i["goal_id"],
                 None if i["progress"] is None else json.dumps(i["progress"]),
                 ts(parse(i["updated_at"])), i["updated_by"]),
            )
        for r in seed["records"]:
            Record.model_validate({**r, "undo": None, "undone_at": None, "project_id": None, "attachments": [],
                                   "card_id": None, "feedback_id": None, "hidden_at": None, "category": None,
                                   "smoke": False})
            conn.execute(
                "INSERT INTO records (id, at, author, source, kind, tier, item_id, title, body,"
                " evidence, needs_processing, smoke) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)",
                (r["id"], ts(parse(r["at"])), r["author"], r["source"], r["kind"], r["tier"],
                 r["item_id"], r["title"], r["body"], r["evidence"], int(r["needs_processing"])),
            )
    return True


def settings_seed_if_empty(path: str) -> bool:
    """Settings arrived after v1 went live, so they seed independently of goals."""
    if one("SELECT 1 FROM settings WHERE id = 1") is not None:
        return False
    with open(path) as f:
        s = SeedSettings.model_validate(json.load(f)["settings"])
    with conn:
        # notify starts all on (api.md 通知设置); the seed does not carry it.
        conn.execute("INSERT INTO settings (id, morning_at, evening_at, evening_enabled, notify, language)"
                     " VALUES (1, ?, ?, ?, ?, ?)",
                     (s.morning_at, s.evening_at, int(s.evening_enabled), json.dumps(NOTIFY_ALL_ON), s.language))
    return True


def projects_seed_if_empty(path: str) -> bool:
    """Projects arrived after v1 went live, so they seed independently of goals. Also assigns
    seed["item_projects"] and backfills project_id on existing records of those items
    (the column is new, so this fills history rather than rewriting it)."""
    if one("SELECT 1 FROM projects LIMIT 1") is not None:
        return False
    with open(path) as f:
        seed = json.load(f)
    with conn:
        for p in seed["projects"]:
            insert_project(ProjectCreateIn.model_validate(p), "active")
        for item_id, project_id in seed["item_projects"].items():
            if conn.execute("UPDATE items SET project_id = ? WHERE id = ?", (project_id, item_id)).rowcount != 1:
                raise ValueError(f"seed item_projects: item {item_id} not in database")
        conn.execute(
            "UPDATE records SET project_id = (SELECT project_id FROM items WHERE items.id = records.item_id)"
            " WHERE item_id IS NOT NULL AND project_id IS NULL"
        )
    return True
