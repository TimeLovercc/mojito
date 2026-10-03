"""mojito hub: storage, API, push, job queue, watchdog. No business judgement here."""

import asyncio
import json
import logging
from collections import Counter
from contextlib import asynccontextmanager
from datetime import date, datetime, time, timedelta

from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request, Response, UploadFile
from fastapi.exception_handlers import http_exception_handler, request_validation_exception_handler
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from pydantic import ValidationError
from starlette.exceptions import HTTPException as StarletteHTTPException

from . import attachments, auth, changes, config, db, health, ical, labels, pages, watchdog, webapp
from .db import conn
from .models import (
    Attachment, ChatIn, ChatList, ChatOut, DecisionIn, DeviceIn, Draft, DraftIn, DraftList, DraftResolveIn,
    DraftStatus, EventIn, EventList, FinishIn, GoalList, HeartbeatIn, Item, ItemDetail, ItemIn,
    ItemList, ItemStatus, Category, Job, JobCreateIn, JobIn, JobList, JobStatus, NeedsYou, Plan,
    PlanDetail, PlanIn, PlanList, Project, ProjectCreateIn, ProjectDecisionIn, ProjectDetail, ProjectOverview,
    ProjectList, ProjectPutIn, ProjectStatus, ProjectSummaryIn, ReadIn, Record, RecordIn,
    RecordList, Review, ReviewFinishIn, Snapshot, Card, CardIn, CardList, CardReadIn, CardStatus,
    CardStatusIn, ItemBefore, USAGE_ACTIONS, USAGE_VIEWS, AuthName,
    AuthStatus, AuthStatusIn, AuthStatusList, UsageIn, UsageSummary,
    ReviewIn, Runner, Settings, Source, SourceList, Today,
)
from .push import push
from .models import (
    Author, Feedback, FeedbackDecisionIn, FeedbackIn, FeedbackList, FeedbackPutIn, FeedbackStatus, RecordKind,
    TasteNote, TasteNoteIn, TasteNoteList, request_path, GoalPutIn, PlanPutIn, NoteLinkIn, Goal,
    FeedbackMessage, FeedbackMessageIn, FeedbackMessageList, FocusItem, Metrics, MetricsDay, MetricsTotals,
    SourceHealthIn, Pulse, PulseCounts, Subscription, SubscriptionEnabledIn, SubscriptionList, SubscriptionPutIn,
    SubscriptionResultIn, CalendarDeleteIn, SettingsPutIn, VapidPublicKey, WebPushEndpointIn, WebPushSubscriptionIn,
    SUBSCRIPTION_CONFIG,
)

FOCUS_STATUSES = ("active", "waiting_you", "scheduled")
# Jobs a chat can start right away (api.md 对话能做的事, 信息流改成报告): mac, no record, deduplicated.
RUN_NOW_KINDS = ("refresh", "sync_projects", "draft_review", "feed_brief", "feed_watch", "feed_mail")
CHAT_TITLE_CHARS = 40


@asynccontextmanager
async def lifespan(app: FastAPI):
    request_path.set("startup")
    db.init()
    db.seed_if_empty(config.SEED_PATH)
    db.settings_seed_if_empty(config.SEED_PATH)
    db.projects_seed_if_empty(config.SEED_PATH)
    dropped = db.drop_orphan_webpush(config.APP_TOKEN_REFS)
    if dropped:
        log.warning("dropped %d Web Push subscription(s) of app tokens that no longer exist", dropped)
    watchdog.run_once()
    tasks = [asyncio.create_task(watchdog.loop()), asyncio.create_task(ical.loop())]
    for task in tasks:
        task.add_done_callback(watchdog.die_on_crash)
    yield
    for task in tasks:
        task.cancel()


# No public /docs, /redoc; the schema is served below to the app token only (api.md §7e).
app = FastAPI(title="mojito hub", version="0", lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)


@app.middleware("http")
async def remember_path(request: Request, call_next):
    request_path.set(f"{request.method} {request.url.path}")
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    return response


# The PWA build (no token, not in the OpenAPI schema).
app.mount("/app", webapp.app(), name="app")
log = logging.getLogger("mojito_hub.api")


# ---- 422 logging: path + where and why, never the submitted values ----

@app.exception_handler(RequestValidationError)
async def log_validation_error(request: Request, exc: RequestValidationError):
    problems = "; ".join(f"{'.'.join(str(p) for p in e['loc'])} {e['type']}: {e['msg']}" for e in exc.errors())
    log.warning("422 %s %s: %s", request.method, request.url.path, problems)
    return await request_validation_exception_handler(request, exc)


@app.exception_handler(StarletteHTTPException)
async def log_hub_422(request: Request, exc: StarletteHTTPException):
    """The hub's own 422s (e.g. a referenced item/project that does not exist)."""
    if exc.status_code == 422:
        log.warning("422 %s %s: %s", request.method, request.url.path, exc.detail)
    return await http_exception_handler(request, exc)


@app.get("/openapi.json", include_in_schema=False, dependencies=[Depends(auth.app_write)])
async def openapi_schema():
    return JSONResponse(app.openapi())


# ---- public pages (no token; kept out of the OpenAPI schema) ----

@app.get("/", response_class=HTMLResponse, include_in_schema=False)
async def home():
    return pages.HOME


@app.get("/privacy", response_class=HTMLResponse, include_in_schema=False)
async def privacy():
    return pages.PRIVACY


# ---- helpers ----

def get_or_404(table: str, id_: str):
    row = db.one(f"SELECT * FROM {table} WHERE id = ?", id_)
    if row is None:
        raise HTTPException(404, f"{id_} not found in {table}")
    return row


def require_ref(table: str, id_: str) -> None:
    """A body field references a missing object → 422."""
    if not db.exists(table, id_):
        raise HTTPException(422, f"{id_} does not exist in {table}")


def by_next_at(items: list[Item]) -> list[Item]:
    return sorted(items, key=lambda i: (i.next_at is None, i.next_at))


def all_items(at: datetime) -> list[Item]:
    return [db.item_of(r, at) for r in db.all_("SELECT * FROM items ORDER BY id")]


def active_plan() -> Plan | None:
    row = db.one("SELECT * FROM plans WHERE status = 'active'")
    return None if row is None else db.plan_of(row)


def plan_detail(plan: Plan, at: datetime) -> PlanDetail:
    goals = {r["id"]: db.goal_of(r) for r in db.all_("SELECT * FROM goals")}
    items = {i.id: i for i in all_items(at)}
    review = db.one("SELECT * FROM reviews WHERE plan_id = ?", plan.id)
    return PlanDetail(plan=plan, goals=[goals[g] for g in plan.goal_ids],
                      items=[items[i] for i in plan.item_ids],
                      review=None if review is None else db.review_of(review))


def last_read_row():
    row = db.one("SELECT record_id FROM reads WHERE id = 1")
    return None if row is None else db.one("SELECT * FROM records WHERE id = ?", row["record_id"])


# ---- app group: reads (app + worker) ----

@app.get("/today", response_model=Today, dependencies=[Depends(auth.app_read)])
async def today():
    return build_today(db.now())


def build_today(at: datetime) -> Today:
    items = all_items(at)
    plan = active_plan()
    today = db.local_today(at)
    tomorrow_start = db.parse(db.local_day_bounds(today)[1])
    open_dated = by_next_at([i for i in items if i.status in FOCUS_STATUSES and i.next_at is not None])
    due_today = [i for i in open_dated if db.local_today(i.next_at) == today]
    later = [i for i in open_dated if i.next_at >= tomorrow_start]
    read = last_read_row()
    if read is None:
        alert_rows = db.all_("SELECT * FROM records WHERE tier = 'interrupt' AND smoke = 0 ORDER BY at DESC, seq DESC")
    else:
        alert_rows = db.all_(
            "SELECT * FROM records WHERE tier = 'interrupt' AND smoke = 0 AND (at > ? OR (at = ? AND seq > ?))"
            " ORDER BY at DESC, seq DESC",
            read["at"], read["at"], read["seq"],
        )
    return Today(
        generated_at=at,
        plan=plan,
        # api.md 今日重点 v3: every open item due today (local), plus the nearest one after today.
        focus=[FocusItem(**i.model_dump(), days_until=(db.local_today(i.next_at) - today).days)
               for i in due_today + later[:1]],
        needs_you=NeedsYou(
            items=by_next_at([i for i in items if i.status == "waiting_you"]),
            plans=[db.plan_of(r) for r in db.all_("SELECT * FROM plans WHERE status = 'draft' ORDER BY start DESC")],
            drafts=[db.draft_of(r) for r in db.all_("SELECT * FROM drafts WHERE status = 'pending' ORDER BY at DESC")],
            projects=[db.project_of(r, at) for r in db.all_("SELECT * FROM projects WHERE status = 'proposed' ORDER BY id")],
            feedback=[db.feedback_of(r) for r in
                      db.all_("SELECT * FROM feedback WHERE status = 'awaiting_approval' ORDER BY at DESC, seq DESC")],
        ),
        overdue=[i for i in items if db.item_lateness(i.status, i.next_at, i.updated_at, at) == "overdue"],
        forgotten=[i for i in items if i.forgotten],
        alerts=[db.record_of(r) for r in alert_rows],
        schedule=db.events_between(*db.local_day_bounds(db.local_today(at))),
    )


@app.get("/goals", response_model=GoalList, dependencies=[Depends(auth.app_read)])
async def goals():
    return GoalList(goals=[db.goal_of(r) for r in db.all_("SELECT * FROM goals ORDER BY id")])


@app.get("/plans/current", response_model=PlanDetail, dependencies=[Depends(auth.app_read)])
async def plans_current():
    plan = active_plan()
    if plan is None:
        raise HTTPException(404, "no active plan")
    return plan_detail(plan, db.now())


@app.get("/plans", response_model=PlanList, dependencies=[Depends(auth.app_read)])
async def plans():
    return PlanList(plans=[db.plan_of(r) for r in db.all_("SELECT * FROM plans ORDER BY start DESC, created_at DESC")])


@app.get("/plans/{plan_id}", response_model=PlanDetail, dependencies=[Depends(auth.app_read)])
async def plan_get(plan_id: str):
    return plan_detail(db.plan_of(get_or_404("plans", plan_id)), db.now())


@app.get("/items", response_model=ItemList, dependencies=[Depends(auth.app_read)])
async def items(category: Category | None = None, status: ItemStatus | None = None,
                forgotten: bool | None = None):
    result = all_items(db.now())
    if category is not None:
        result = [i for i in result if i.category == category]
    if status is not None:
        result = [i for i in result if i.status == status]
    if forgotten is not None:
        result = [i for i in result if i.forgotten == forgotten]
    return ItemList(items=result)


@app.get("/items/{item_id}", response_model=ItemDetail, dependencies=[Depends(auth.app_read)])
async def item_get(item_id: str):
    item = db.item_of(get_or_404("items", item_id), db.now())
    rows = db.all_("SELECT * FROM records WHERE item_id = ? AND hidden_at IS NULL AND smoke = 0"
                   " ORDER BY at DESC, seq DESC", item_id)
    return ItemDetail(item=item, records=[db.record_of(r) for r in rows])


@app.get("/records", response_model=RecordList, dependencies=[Depends(auth.app_read)])
async def records(limit: int = Query(gt=0, le=500), before: str | None = None, kind: RecordKind | None = None,
                  author: Author | None = None, project_id: str | None = None, include_hidden: bool = False,
                  include_smoke: bool = False):
    where, args = ["1 = 1" if include_hidden else "hidden_at IS NULL", "1 = 1" if include_smoke else "smoke = 0"], []
    if before is not None:
        b = get_or_404("records", before)
        where.append("(at < ? OR (at = ? AND seq < ?))")
        args += [b["at"], b["at"], b["seq"]]
    for column, value in (("kind", kind), ("author", author), ("project_id", project_id)):
        if value is not None:
            where.append(f"{column} = ?")
            args.append(value)
    rows = db.all_(f"SELECT * FROM records WHERE {' AND '.join(where)} ORDER BY at DESC, seq DESC LIMIT ?",
                   *args, limit)
    read = db.one("SELECT record_id FROM reads WHERE id = 1")
    return RecordList(records=[db.record_of(r) for r in rows],
                      last_read_id=None if read is None else read["record_id"])


@app.get("/records/{record_id}", response_model=Record, dependencies=[Depends(auth.app_read)])
async def record_get(record_id: str):
    return db.record_of(get_or_404("records", record_id))


@app.get("/jobs/{job_id}", response_model=Job, dependencies=[Depends(auth.app_read)])
async def job_get(job_id: str):
    return db.job_of(get_or_404("jobs", job_id))


@app.get("/sources", response_model=SourceList, dependencies=[Depends(auth.app_read)])
async def sources():
    at = db.now()
    return SourceList(sources=[db.source_of(r, at) for r in db.all_("SELECT * FROM sources ORDER BY name")])


# ---- app group: writes (app only) ----

@app.post("/records", response_model=Record, dependencies=[Depends(auth.app_write)])
async def record_create(body: RecordIn):
    if body.item_id is not None:
        require_ref("items", body.item_id)
    if body.project_id is not None:
        require_ref("projects", body.project_id)
    check_attachments(body.body, body.attachment_ids)
    at = db.now()
    with conn:
        rec = db.insert_record(
            at=at, author="me", source="app", kind="note", tier="log", item_id=body.item_id,
            project_id=body.project_id, title=body.title if body.body != "" else labels.t("image"), body=body.body,
            evidence=None, needs_processing=body.needs_processing, undo=None, card_id=None, category=None,
            smoke=body.smoke,
        )
        conn.executemany("UPDATE attachments SET record_id = ? WHERE id = ?",
                         [(rec.id, aid) for aid in body.attachment_ids])
        # A smoke note is checked and written as usual but never processed (api.md 冒烟标记).
        if body.needs_processing and not body.smoke:
            db.insert_job(kind="process_note", runner="mac", record_id=rec.id, payload=None, at=at)
    return db.record_of(get_or_404("records", rec.id))


OPEN_ITEM_STATUSES = ("active", "waiting_you", "scheduled", "standing")
# action → (statuses it applies to, new status) for the status-only decisions
STATUS_DECISIONS = {
    "approve": (("waiting_you",), "active"),
    "decline": (("waiting_you",), "closed"),
    "done": (OPEN_ITEM_STATUSES, "done"),
    "close": (OPEN_ITEM_STATUSES, "closed"),
    "reopen": (("done", "closed"), "active"),
}


@app.post("/items/{item_id}/decision", response_model=Item, dependencies=[Depends(auth.app_write)])
async def item_decision(item_id: str, body: DecisionIn):
    row = get_or_404("items", item_id)
    if (body.action == "postpone") != (body.until is not None):
        raise HTTPException(422, "until is required for postpone and only allowed there")
    if body.action != "postpone" and row["status"] not in STATUS_DECISIONS[body.action][0]:
        allowed = " or ".join(STATUS_DECISIONS[body.action][0])
        raise HTTPException(409, f"item {item_id} is {row['status']}; {body.action} needs {allowed}")
    at = db.now()
    if body.action == "postpone":
        status, next_at = row["status"], db.ts(body.until)
        detail = labels.item_change("next_at", row["next_at"], next_at)
    else:
        status = STATUS_DECISIONS[body.action][1]
        next_at = row["next_at"]
        detail = labels.item_change("status", row["status"], status)
    with conn:
        conn.execute(
            "UPDATE items SET status = ?, next_at = ?, updated_at = ?, updated_by = 'app' WHERE id = ?",
            (status, next_at, db.ts(at), item_id),
        )
        db.log_item_changes(item_id, row, at)
        db.insert_record(
            at=at, author="me", source="app", kind="decision", tier="log", item_id=item_id,
            project_id=None,
            title=labels.titled(labels.t(f"decision_{body.action}"), row["title"]), body=detail,
            evidence=None, needs_processing=False, undo=None, card_id=None, category=None, smoke=False,
        )
        if body.action in ("done", "close", "reopen"):
            write_item_change_record(item_id, row, at, author="me", source="app")
    return db.item_of(get_or_404("items", item_id), at)


UNDOABLE_ITEM_FIELDS = ("title", "status", "next_step", "next_at", "owner", "project_id")


def write_item_change_record(item_id: str, old, at, *, author: str, source: str) -> Record | None:
    """After an existing item changed: one log record "<item>：<field> 从 X 改成 Y" carrying an
    item undo of the changed undoable fields, plus its undo mark. None if none of them changed
    (category/goal_id/progress changes are not recorded)."""
    new = get_or_404("items", item_id)
    changed = [f for f in UNDOABLE_ITEM_FIELDS if old[f] != new[f]]
    if not changed:
        return None
    rec = db.insert_record(
        at=at, author=author, source=source, kind="log", tier="log", item_id=item_id, project_id=None,
        title=labels.titled(new["title"], labels.t("changes_sep").join(labels.item_change(f, old[f], new[f]) for f in changed)),
        body="", evidence=None, needs_processing=False,
        undo={"type": "item", "item_id": item_id, "before": {f: old[f] for f in changed}}, card_id=None, category=None, smoke=False,
    )
    conn.execute("INSERT INTO undo_marks (record_id, change_seq) VALUES (?, ?)", (rec.id, db.last_item_change_seq()))
    return rec


@app.post("/plans/{plan_id}/approve", response_model=Plan, dependencies=[Depends(auth.app_write)])
async def plan_approve(plan_id: str):
    row = get_or_404("plans", plan_id)
    if row["status"] != "draft":
        raise HTTPException(409, f"plan {plan_id} is {row['status']}, not draft")
    # No new period without a finished review of every earlier period that actually ran.
    # A plan replaced by an approved revision needs no review of its own (its revision does).
    unreviewed = db.all_(
        "SELECT p.id FROM plans p LEFT JOIN reviews r ON r.plan_id = p.id"
        " WHERE p.status != 'draft' AND p.\"end\" < ? AND (r.status IS NULL OR r.status != 'done')"
        " AND NOT EXISTS (SELECT 1 FROM plans q WHERE q.revises = p.id AND q.status != 'draft')",
        row["start"],
    )
    if unreviewed:
        raise HTTPException(409, f"review not done for plan(s) {', '.join(r['id'] for r in unreviewed)}")
    at = db.now()
    with conn:
        db.close_active_plans(at, expired_only=False)
        conn.execute("UPDATE plans SET status = 'active' WHERE id = ?", (plan_id,))
    return db.plan_of(get_or_404("plans", plan_id))


@app.post("/jobs", response_model=Job, dependencies=[Depends(auth.app_write)])
async def job_create(body: JobIn):
    with conn:
        return db.insert_job(kind=body.kind, runner="mac", record_id=None, payload=None, at=db.now())


@app.post("/devices", status_code=204, dependencies=[Depends(auth.app_write)])
async def device_register(body: DeviceIn):
    with conn:
        conn.execute("INSERT OR REPLACE INTO devices (fcm_token, registered_at) VALUES (?, ?)",
                     (body.fcm_token, db.ts(db.now())))
    return Response(status_code=204)


@app.post("/reads", status_code=204, dependencies=[Depends(auth.app_write)])
async def read_mark(body: ReadIn):
    require_ref("records", body.record_id)
    with conn:
        conn.execute("INSERT OR REPLACE INTO reads (id, record_id) VALUES (1, ?)", (body.record_id,))
    return Response(status_code=204)


# ---- worker group ----

@app.post("/worker/lease", response_model=Job, responses={204: {"description": "no queued job"}})
async def worker_lease(r: str = Depends(auth.runners)):
    """worker leases runner=mac, agent leases runner=server; chat_reply first."""
    row = db.one(
        "SELECT * FROM jobs WHERE status = 'queued' AND runner = ?"
        " ORDER BY kind = 'chat_reply' DESC, requested_at, seq LIMIT 1",
        auth.RUNNER_OF[r],
    )
    if row is None:
        return Response(status_code=204)
    with conn:
        conn.execute("UPDATE jobs SET status = 'running', started_at = ? WHERE id = ?",
                     (db.ts(db.now()), row["id"]))
    return db.job_of(get_or_404("jobs", row["id"]))


@app.post("/worker/jobs", response_model=Job)
async def worker_job_create(body: JobCreateIn, r: str = Depends(auth.runners)):
    """api.md 对话能做的事: chat_reply (forwarding a message, either runner) or one of the jobs
    a chat can start now (mac, no record; an already queued/running one of that kind is returned)."""
    if body.kind == "chat_reply":
        if body.record_id is None:
            raise HTTPException(422, "chat_reply needs record_id")
        require_ref("records", body.record_id)
        with conn:
            return db.insert_job(kind="chat_reply", runner=body.runner, record_id=body.record_id, payload=None,
                                 at=db.now())
    if body.kind not in RUN_NOW_KINDS:
        raise HTTPException(422, f"{body.kind} cannot be started through /worker/jobs")
    if body.runner != "mac":
        raise HTTPException(422, f"{body.kind} always runs on mac")
    if body.record_id is not None:
        raise HTTPException(422, f"{body.kind} takes no record_id")
    return start_job_now(body.kind)



def start_job_now(kind: str) -> Job:
    """Queue a mac job, or return the one of that kind already queued or running."""
    row = db.one("SELECT * FROM jobs WHERE kind = ? AND status IN ('queued', 'running') ORDER BY seq DESC LIMIT 1", kind)
    if row is not None:
        return db.job_of(row)
    with conn:
        return db.insert_job(kind=kind, runner="mac", record_id=None, payload=None, at=db.now())


@app.post("/worker/jobs/{job_id}/finish", response_model=Job)
async def worker_finish(job_id: str, body: FinishIn, r: str = Depends(auth.runners)):
    row = get_or_404("jobs", job_id)
    if row["runner"] != auth.RUNNER_OF[r]:
        raise HTTPException(403, f"job {job_id} runs on {row['runner']}, not {auth.RUNNER_OF[r]}")
    if row["status"] != "running":
        raise HTTPException(409, f"job {job_id} is {row['status']}, not running")
    if (body.status == "failed") != (body.error is not None):
        raise HTTPException(422, "error is required for failed and only allowed there")
    at = db.now()
    rec = None
    # The failure record of a job for a smoke record (a smoke chat's reply) is smoke too.
    smoke = row["record_id"] is not None and bool(db.one("SELECT smoke FROM records WHERE id = ?", row["record_id"])["smoke"])
    with conn:
        conn.execute("UPDATE jobs SET status = ?, finished_at = ?, error = ? WHERE id = ?",
                     (body.status, db.ts(at), body.error, job_id))
        if body.status == "failed":
            rec = db.insert_record(
                at=at, author="system", source="hub", kind="alert", tier="digest", item_id=None,
                project_id=None,
                title=labels.t("job_failed", job=labels.name("job", row["kind"]), error=body.error),
                body=labels.t("job_failed_body", job=labels.name("job", row["kind"]), error=body.error),
                evidence=None, needs_processing=False, undo=None, card_id=None, category=None, smoke=smoke,
            )
        elif row["kind"] == "refresh":
            rec = db.insert_record(
                at=at, author="system", source="hub", kind="log", tier="digest", item_id=None,
                project_id=None,
                title=labels.t("refreshed"), body=labels.t("refreshed_body"),
                evidence=None, needs_processing=False, undo=None, card_id=None, category=None, smoke=False,
            )
        elif row["kind"] == "undo":
            conn.execute("UPDATE records SET undone_at = ? WHERE id = ?", (db.ts(at), row["record_id"]))
    if rec is not None:
        push(rec)
    return db.job_of(get_or_404("jobs", job_id))


@app.put("/items/{item_id}", response_model=Item)
async def item_put(item_id: str, body: ItemIn, r: str = Depends(auth.item_writers)):
    """New items from the agent must be waiting_you drafts; existing items may be changed by
    agent and worker (in-chat item_updates), except done_definition."""
    old = db.one("SELECT * FROM items WHERE id = ?", item_id)
    if body.goal_id is not None:
        require_ref("goals", body.goal_id)
    if body.project_id is not None:
        require_ref("projects", body.project_id)
    if old is not None and old["done_definition"] != body.done_definition:
        raise HTTPException(409, f"done_definition of {item_id} is fixed at creation")
    at = db.now()
    with conn:
        conn.execute(
            "INSERT OR REPLACE INTO items (id, title, category, status, next_step, next_at, owner,"
            " done_definition, goal_id, project_id, progress, updated_at, updated_by)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (item_id, body.title, body.category, body.status, body.next_step,
             db.ts_or_null(body.next_at), body.owner, body.done_definition, body.goal_id,
             body.project_id,
             None if body.progress is None else json.dumps(body.progress), db.ts(at),
             auth.SOURCE_OF[r]),
        )
        db.log_item_changes(item_id, old, at)
        if old is None and r == "worker":
            note = running_process_note()
            if note is not None:
                link_card_to_new_item(item_id, note)
                db.insert_record(
                    at=at, author="system", source="worker", kind="log", tier="log", item_id=item_id,
                    project_id=None, title=labels.t("note_to_item", x=body.title), body=labels.t("from_note", x=note["title"]),
                    evidence=None, needs_processing=False, undo={"type": "item_create", "item_id": item_id},
                    card_id=None, category=None, smoke=False,
                )
        if old is not None:
            write_item_change_record(item_id, old, at, author="system", source=auth.SOURCE_OF[r])
    return db.item_of(get_or_404("items", item_id), at)


def running_process_note():
    """The note of the process_note job the (single-threaded) Mac worker is running, if any."""
    return db.one(
        "SELECT r.* FROM jobs j JOIN records r ON r.id = j.record_id"
        " WHERE j.kind = 'process_note' AND j.runner = 'mac' AND j.status = 'running'"
    )


def link_card_to_new_item(item_id: str, note) -> None:
    """A card turned into an item (POST /cards/{id}/to-item) gets the item the worker creates
    while running that note's process_note job."""
    if note["card_id"] is not None:
        conn.execute("UPDATE cards SET item_id = ? WHERE id = ? AND item_id IS NULL", (item_id, note["card_id"]))


@app.post("/plans", response_model=Plan, dependencies=[Depends(auth.plan_writers)])
async def plan_create(body: PlanIn):
    if body.start > body.end:
        raise HTTPException(422, "start is after end")
    if body.revises is not None:
        target = db.one("SELECT * FROM plans WHERE id = ?", body.revises)
        if target is None:
            raise HTTPException(422, f"plan {body.revises} does not exist")
        if target["status"] != "active":
            raise HTTPException(409, f"only the active plan can be revised; {body.revises} is {target['status']}")
        if (body.start.isoformat(), body.end.isoformat()) != (target["start"], target["end"]):
            raise HTTPException(422, f"a revision keeps the period of {body.revises} ({target['start']} – {target['end']})")
    for g in body.goal_ids:
        require_ref("goals", g)
    for i in body.item_ids:
        require_ref("items", i)
    if db.exists("plans", body.id):
        raise HTTPException(409, f"plan {body.id} already exists")
    pid = body.id
    with conn:
        conn.execute(
            'INSERT INTO plans (id, start, "end", goal_ids, item_ids, status, created_at, closed_at, revises)'
            " VALUES (?, ?, ?, ?, ?, 'draft', ?, NULL, ?)",
            (pid, body.start.isoformat(), body.end.isoformat(), json.dumps(body.goal_ids),
             json.dumps(body.item_ids), db.ts(db.now()), body.revises),
        )
        if body.revises is not None:
            # Only the newest draft revision of a plan stays pending.
            conn.execute("UPDATE plans SET status = 'closed', closed_at = ? WHERE revises = ? AND status = 'draft'"
                         " AND id != ?", (db.ts(db.now()), body.revises, pid))
    return db.plan_of(get_or_404("plans", pid))


# ---- source group (source:<name> + worker) ----

@app.post("/sources/{name}/heartbeat", response_model=Source)
async def heartbeat(name: str, body: HeartbeatIn, src: str = Depends(auth.heartbeat_source),
                    r: str = Depends(auth.role)):
    if not auth.may_report_for(r, src, name):
        raise HTTPException(403, f"token is for source {src}, not {name}")
    at = db.now()
    with conn:
        db.heartbeat(name, body.expected_interval_s, at)
    return db.source_of(db.one("SELECT * FROM sources WHERE name = ?", name), at)


@app.post("/events", response_model=Record)
async def event_create(body: EventIn, src: str = Depends(auth.source), r: str = Depends(auth.role)):
    if body.undo is not None:
        check_undo(body.undo, r)
    if body.item_id is not None:
        require_ref("items", body.item_id)
    if body.project_id is not None:
        require_ref("projects", body.project_id)
        project_id = body.project_id
    elif body.repo_path is not None:
        project_id = db.project_for_repo_path(body.repo_path)
    else:
        project_id = None
    with conn:
        rec = db.insert_record(
            at=db.now(), author="system", source=src, kind=body.kind, tier=body.tier,
            item_id=body.item_id, project_id=project_id,
            title=body.title, body=body.body, evidence=body.evidence,
            needs_processing=False, undo=body.undo, card_id=None, category=body.category, smoke=body.smoke,
        )
    push(rec)
    return rec


def check_undo(undo: dict, role: str) -> None:
    """Only calendar undo comes through /events (agent only: it holds the Google credentials).
    Item undo records are written by the hub itself on PUT /items and decisions."""
    if "type" not in undo or undo["type"] != "calendar":
        raise HTTPException(422, "undo.type must be calendar (item changes are recorded by the hub)")
    if role != "agent":
        raise HTTPException(403, "only the agent may write calendar undo")


NOT_NULL_ITEM_FIELDS = ("next_step", "status", "owner", "title")


def item_before(before: dict) -> dict:
    """Validate `before` and return it as column values (datetimes as stored strings)."""
    try:
        parsed = ItemBefore.model_validate(before)
    except ValidationError as e:
        raise HTTPException(422, f"undo.before: {e.errors(include_input=False)}") from e
    fields = parsed.model_fields_set
    if not fields:
        raise HTTPException(422, "undo.before is empty")
    nulls = [f for f in fields if f in NOT_NULL_ITEM_FIELDS and getattr(parsed, f) is None]
    if nulls:
        raise HTTPException(422, f"undo.before: {', '.join(nulls)} cannot be null")
    if "project_id" in fields and parsed.project_id is not None:
        require_ref("projects", parsed.project_id)
    return {f: db.ts_or_null(parsed.next_at) if f == "next_at" else getattr(parsed, f) for f in fields}


# ---- v2a: chat, settings, calendar, job list ----

@app.post("/chat", response_model=ChatOut, dependencies=[Depends(auth.app_write)])
async def chat_send(body: ChatIn):
    if body.item_id is not None:
        require_ref("items", body.item_id)
    if body.project_id is not None:
        require_ref("projects", body.project_id)
    if body.card_id is not None:
        require_ref("cards", body.card_id)
    check_attachments(body.body, body.attachment_ids)
    at = db.now()
    title = body.body[:CHAT_TITLE_CHARS] if body.body != "" else labels.t("image")
    with conn:
        rec = db.insert_record(
            at=at, author="me", source="app", kind="chat", tier="log", item_id=body.item_id,
            project_id=body.project_id,
            title=title, body=body.body, evidence=None, needs_processing=False, undo=None, card_id=body.card_id, category=None,
            smoke=body.smoke,
        )
        conn.executemany("UPDATE attachments SET record_id = ? WHERE id = ?",
                         [(rec.id, aid) for aid in body.attachment_ids])
        job = db.insert_job(kind="chat_reply", runner="server", record_id=rec.id, payload=None, at=at)
    return ChatOut(record=db.record_of(get_or_404("records", rec.id)), job=job)


def check_attachments(text: str, attachment_ids: list[str], *, reuse_chat_images: bool = False) -> list[str]:
    """Chat messages, feedback and feedback messages: text or at least one image; images
    exist, unused, no repeats. With reuse_chat_images (the agent forwarding the user's chat
    message), images already on one of the user's chat messages are allowed; the returned
    list names those, which the caller copies (one holder per image)."""
    if text == "" and not attachment_ids:
        raise HTTPException(422, "a message needs a body or at least one image")
    if len(set(attachment_ids)) != len(attachment_ids):
        raise HTTPException(422, "attachment_ids has duplicates")
    to_copy = []
    for aid in attachment_ids:
        att = db.one("SELECT record_id, message_id FROM attachments WHERE id = ?", aid)
        if att is None:
            raise HTTPException(422, f"attachment {aid} does not exist")
        if att["message_id"] is not None:
            raise HTTPException(422, f"attachment {aid} already belongs to feedback message {att['message_id']}")
        card = db.one("SELECT id FROM cards WHERE image_attachment_id = ?", aid)
        if card is not None:
            raise HTTPException(422, f"attachment {aid} is the image of card {card['id']}")
        if att["record_id"] is None:
            continue
        owner = db.one("SELECT kind, author FROM records WHERE id = ?", att["record_id"])
        if not (reuse_chat_images and owner["kind"] == "chat" and owner["author"] == "me"):
            raise HTTPException(422, f"attachment {aid} already belongs to record {att['record_id']}")
        to_copy.append(aid)
    return to_copy


async def own_attachments(attachment_ids: list[str], to_copy: list[str]) -> list[str]:
    """Final ids to attach: copies (new files and rows) for the ids in to_copy, the rest as is.
    Call before the transaction that links them; the copy rows are unlinked until then."""
    final = []
    for aid in attachment_ids:
        if aid not in to_copy:
            final.append(aid)
            continue
        src = get_or_404("attachments", aid)
        new_id = db.new_id("a")
        await asyncio.to_thread(attachments.copy, aid, new_id)
        with conn:
            conn.execute(
                "INSERT INTO attachments (id, content_type, bytes, width, height, created_at, record_id, message_id)"
                " VALUES (?, ?, ?, ?, ?, ?, NULL, NULL)",
                (new_id, src["content_type"], src["bytes"], src["width"], src["height"], db.ts(db.now())),
            )
        final.append(new_id)
    return final


@app.post("/attachments", response_model=Attachment, dependencies=[Depends(auth.uploaders)])
async def attachment_upload(file: UploadFile):
    if file.content_type != "image/jpeg":
        raise HTTPException(422, f"only image/jpeg is accepted, got {file.content_type}")
    data = await file.read(attachments.MAX_BYTES + 1)
    if len(data) > attachments.MAX_BYTES:
        raise HTTPException(422, f"image is larger than {attachments.MAX_BYTES} bytes")
    try:
        width, height = attachments.jpeg_size(data)
    except ValueError as e:
        raise HTTPException(422, str(e)) from e
    aid = db.new_id("a")
    await asyncio.to_thread(attachments.save, aid, data)
    with conn:
        conn.execute(
            "INSERT INTO attachments (id, content_type, bytes, width, height, created_at, record_id)"
            " VALUES (?, 'image/jpeg', ?, ?, ?, ?, NULL)",
            (aid, len(data), width, height, db.ts(db.now())),
        )
    return db.attachment_of(get_or_404("attachments", aid))


@app.get("/attachments/{attachment_id}", response_class=FileResponse, dependencies=[Depends(auth.app_read)],
         responses={200: {"content": {"image/jpeg": {}}, "description": "the image bytes"}})
async def attachment_get(attachment_id: str):
    get_or_404("attachments", attachment_id)
    return FileResponse(attachments.path_of(attachment_id), media_type="image/jpeg")


@app.get("/chat", response_model=ChatList, dependencies=[Depends(auth.app_read)])
async def chat_list(limit: int = Query(gt=0, le=500), before: str | None = None,
                    item_id: str | None = None, project_id: str | None = None, include_smoke: bool = False):
    where, args = ["kind = 'chat'", "1 = 1" if include_smoke else "smoke = 0"], []
    if before is not None:
        b = get_or_404("records", before)
        where.append("(at < ? OR (at = ? AND seq < ?))")
        args += [b["at"], b["at"], b["seq"]]
    if item_id is not None:
        where.append("item_id = ?")
        args.append(item_id)
    if project_id is not None:
        where.append("project_id = ?")
        args.append(project_id)
    rows = db.all_(f"SELECT * FROM records WHERE {' AND '.join(where)} ORDER BY at DESC, seq DESC LIMIT ?",
                   *args, limit)
    return ChatList(records=[db.record_of(r) for r in rows])


@app.get("/settings", response_model=Settings, dependencies=[Depends(auth.settings_readers)])
async def settings_get():
    return db.settings_of(db.one("SELECT * FROM settings WHERE id = 1"))


@app.put("/settings", response_model=Settings, dependencies=[Depends(auth.settings_writers)])
async def settings_put(body: SettingsPutIn, r: str = Depends(auth.role)):
    old = changes.row("settings", changes.SETTINGS_ID)
    at = db.now()
    author, source = auth.actor(r)
    notify = old["notify"] if body.notify is None else json.dumps(body.notify.model_dump())
    language = old["language"] if body.language is None else body.language
    with conn:
        conn.execute("UPDATE settings SET morning_at = ?, evening_at = ?, evening_enabled = ?, notify = ?, language = ?"
                     " WHERE id = 1", (body.morning_at, body.evening_at, int(body.evening_enabled), notify, language))
        changes.record("settings", changes.SETTINGS_ID, old, at, author=author, source=source)
    return db.settings_of(db.one("SELECT * FROM settings WHERE id = 1"))


@app.get("/calendar", response_model=EventList, dependencies=[Depends(auth.app_read)])
async def calendar(from_: date = Query(alias="from"), to: date = Query()):
    if from_ > to:
        raise HTTPException(422, "from is after to")
    return EventList(events=db.events_between(db.local_day_bounds(from_)[0], db.local_day_bounds(to)[1]))


@app.get("/jobs", response_model=JobList, dependencies=[Depends(auth.app_get)])
async def jobs(status: JobStatus | None = None, runner: Runner | None = None):
    where, args = ["1 = 1"], []
    if status is not None:
        where.append("status = ?")
        args.append(status)
    if runner is not None:
        where.append("runner = ?")
        args.append(runner)
    rows = db.all_(f"SELECT * FROM jobs WHERE {' AND '.join(where)} ORDER BY requested_at DESC, seq DESC LIMIT 50",
                   *args)
    return JobList(jobs=[db.job_of(r) for r in rows])


# ---- v2b/v3: undo, calendar refresh, drafts, reviews ----

@app.post("/records/{record_id}/undo", response_model=Job, dependencies=[Depends(auth.app_write)])
async def record_undo(record_id: str):
    row = get_or_404("records", record_id)
    if row["undo"] is None:
        raise HTTPException(409, f"record {record_id} has nothing to undo")
    if row["undone_at"] is not None:
        raise HTTPException(409, f"record {record_id} was already undone")
    if db.one("SELECT 1 FROM jobs WHERE kind = 'undo' AND record_id = ? AND status IN ('queued', 'running')",
              record_id):
        raise HTTPException(409, f"undo of {record_id} is already in progress")
    undo = json.loads(row["undo"])
    if undo["type"] == "item":
        return undo_item(row, undo)
    if undo["type"] == "item_create":
        return undo_item_create(row, undo)
    if undo["type"] == "project_overview":
        at = db.now()
        with conn:
            changes.undo_overview(row, undo, at)
            return finish_hub_undo(row["id"], at)
    if undo["type"] in changes.ENTITIES:
        at = db.now()
        with conn:
            changes.undo(row, undo, at)
            return finish_hub_undo(row["id"], at)
    with conn:
        return db.insert_job(kind="undo", runner="server", record_id=record_id, payload=None, at=db.now())


def finish_hub_undo(record_id: str, at) -> Job:
    """Mark the record undone and return an undo job that is already done (inside a transaction)."""
    conn.execute("UPDATE records SET undone_at = ? WHERE id = ?", (db.ts(at), record_id))
    job = db.insert_job(kind="undo", runner="server", record_id=record_id, payload=None, at=at)
    conn.execute("UPDATE jobs SET status = 'done', started_at = ?, finished_at = ? WHERE id = ?",
                 (db.ts(at), db.ts(at), job.id))
    return db.job_of(get_or_404("jobs", job.id))


def undo_item_create(record, undo: dict) -> Job:
    """Undo "a note became an item": close the item and detach the notes linked to it."""
    item_id = undo["item_id"]
    old = get_or_404("items", item_id)
    at = db.now()
    with conn:
        conn.execute("UPDATE items SET status = 'closed', updated_at = ?, updated_by = 'app' WHERE id = ?",
                     (db.ts(at), item_id))
        db.log_item_changes(item_id, old, at)
        for note in db.all_("SELECT * FROM records WHERE item_id = ? AND kind = 'note' AND author = 'me'", item_id):
            conn.execute("UPDATE records SET item_id = NULL WHERE id = ?", (note["id"],))
            changes.log_changes("note", note["id"], note, at)
        db.insert_record(
            at=at, author="me", source="app", kind="log", tier="log", item_id=item_id, project_id=None,
            title=labels.t("undone", x=record["title"]), body=labels.t("item_create_undone"),
            evidence=None, needs_processing=False, undo=None, card_id=None, category=None, smoke=False,
        )
        return finish_hub_undo(record["id"], at)


def undo_item(record, undo: dict) -> Job:
    """Item undo is done by the hub itself: restore `before`, unless one of those fields
    changed again after the record was written."""
    item_id, values = undo["item_id"], item_before(undo["before"])
    mark = db.one("SELECT change_seq FROM undo_marks WHERE record_id = ?", record["id"])["change_seq"]
    later = db.all_(
        f"SELECT DISTINCT field FROM item_changes WHERE item_id = ? AND seq > ?"
        f" AND field IN ({', '.join('?' * len(values))})",
        item_id, mark, *values,
    )
    if later:
        raise HTTPException(409, labels.t("changed_later", x=labels.joined([labels.name("item_field", r["field"]) for r in later])))
    old = get_or_404("items", item_id)
    at = db.now()
    with conn:
        conn.execute(
            f"UPDATE items SET {', '.join(f'{f} = ?' for f in values)}, updated_at = ?, updated_by = 'app' WHERE id = ?",
            (*values.values(), db.ts(at), item_id),
        )
        db.log_item_changes(item_id, old, at)
        db.insert_record(
            at=at, author="me", source="app", kind="log", tier="log", item_id=item_id, project_id=None,
            title=labels.t("undone", x=record["title"]),
            body=labels.t("restored", x=labels.t("parts_sep").join(
                labels.t("field_value", field=labels.name("item_field", f), value=labels.item_value(f, v))
                for f, v in values.items())),
            evidence=None, needs_processing=False, undo=None, card_id=None, category=None, smoke=False,
        )
        return finish_hub_undo(record["id"], at)


@app.post("/calendar/refresh", response_model=EventList, dependencies=[Depends(auth.agent)])
async def calendar_refresh():
    """Re-fetch the iCal feed now (after the agent wrote to Google Calendar); returns the
    events from today (local) on. A failed fetch is a 502 for the caller."""
    try:
        await ical.refresh()
    except (OSError, ValueError) as e:
        raise HTTPException(502, f"calendar fetch failed: {ical.describe(e)}") from e
    start = db.local_day_bounds(db.local_today(db.now()))[0]
    return EventList(events=db.events_between(start, "9999"))


@app.put("/drafts/{draft_id}", response_model=Draft)
async def draft_put(draft_id: str, body: DraftIn, r: str = Depends(auth.runners)):
    if db.exists("drafts", draft_id):
        raise HTTPException(409, f"draft {draft_id} already exists")
    if body.item_id is not None:
        require_ref("items", body.item_id)
    with conn:
        conn.execute(
            'INSERT INTO drafts (id, at, source, channel, "to", subject, body, item_id, status)'
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')",
            (draft_id, db.ts(db.now()), auth.SOURCE_OF[r], body.channel, body.to, body.subject,
             body.body, body.item_id),
        )
    return db.draft_of(get_or_404("drafts", draft_id))


@app.get("/drafts", response_model=DraftList, dependencies=[Depends(auth.app_read)])
async def drafts(status: DraftStatus | None = None):
    if status is None:
        rows = db.all_("SELECT * FROM drafts ORDER BY at DESC")
    else:
        rows = db.all_("SELECT * FROM drafts WHERE status = ? ORDER BY at DESC", status)
    return DraftList(drafts=[db.draft_of(r) for r in rows])




@app.post("/drafts/{draft_id}/resolve", response_model=Draft, dependencies=[Depends(auth.app_write)])
async def draft_resolve(draft_id: str, body: DraftResolveIn):
    row = get_or_404("drafts", draft_id)
    if row["status"] != "pending":
        raise HTTPException(409, f"draft {draft_id} is {row['status']}, not pending")
    at = db.now()
    with conn:
        conn.execute("UPDATE drafts SET status = ? WHERE id = ?", (body.status, draft_id))
        db.insert_record(
            at=at, author="me", source="app", kind="decision", tier="log", item_id=row["item_id"],
            project_id=None,
            title=labels.titled(labels.name("draft_status", body.status),
                                row["subject"] if row["subject"] is not None else row["to"]),
            body=labels.t("draft_resolved", to=row["to"], channel=labels.name("draft_channel", row["channel"]),
                          status=labels.name("draft_status", body.status)),
            evidence=None, needs_processing=False, undo=None, card_id=None, category=None, smoke=False,
        )
    return db.draft_of(get_or_404("drafts", draft_id))


@app.put("/reviews/{plan_id}", response_model=Review, dependencies=[Depends(auth.worker)])
async def review_put(plan_id: str, body: ReviewIn):
    get_or_404("plans", plan_id)
    old = db.one("SELECT * FROM reviews WHERE plan_id = ?", plan_id)
    if old is not None and old["status"] == "done":
        raise HTTPException(409, f"review of {plan_id} is done")
    for i in body.completed_item_ids + body.missed_item_ids:
        require_ref("items", i)
    created_at = db.ts(db.now()) if old is None else old["created_at"]
    with conn:
        conn.execute(
            "INSERT OR REPLACE INTO reviews (plan_id, created_at, summary, completed_item_ids,"
            " missed_item_ids, patterns, user_note, status) VALUES (?, ?, ?, ?, ?, ?, NULL, 'draft')",
            (plan_id, created_at, body.summary, json.dumps(body.completed_item_ids),
             json.dumps(body.missed_item_ids), json.dumps(body.patterns)),
        )
    return db.review_of(db.one("SELECT * FROM reviews WHERE plan_id = ?", plan_id))


@app.post("/reviews/{plan_id}/finish", response_model=Review, dependencies=[Depends(auth.app_write)])
async def review_finish(plan_id: str, body: ReviewFinishIn):
    row = db.one("SELECT * FROM reviews WHERE plan_id = ?", plan_id)
    if row is None:
        raise HTTPException(404, f"no review for plan {plan_id}")
    if row["status"] == "done":
        raise HTTPException(409, f"review of {plan_id} is already done")
    with conn:
        conn.execute("UPDATE reviews SET user_note = ?, status = 'done' WHERE plan_id = ?",
                     (body.user_note, plan_id))
    return db.review_of(db.one("SELECT * FROM reviews WHERE plan_id = ?", plan_id))


# ---- projects ----

@app.get("/projects", response_model=ProjectList, dependencies=[Depends(auth.app_read)])
async def projects(area: Category | None = None, status: ProjectStatus | None = None):
    statuses = ("active", "paused") if status is None else (status,)
    where, args = [f"status IN ({', '.join('?' * len(statuses))})"], list(statuses)
    if area is not None:
        where.append("area = ?")
        args.append(area)
    at = db.now()
    rows = db.all_(f"SELECT * FROM projects WHERE {' AND '.join(where)} ORDER BY area, title COLLATE NOCASE", *args)
    return ProjectList(projects=[db.project_of(r, at) for r in rows])


@app.get("/projects/{project_id}", response_model=ProjectDetail, dependencies=[Depends(auth.app_read)])
async def project_get(project_id: str):
    at = db.now()
    project = db.project_of(get_or_404("projects", project_id), at)
    items = [db.item_of(r, at) for r in db.all_("SELECT * FROM items WHERE project_id = ? ORDER BY id", project_id)]
    records = db.all_("SELECT * FROM records WHERE project_id = ? AND hidden_at IS NULL AND smoke = 0"
                      " ORDER BY at DESC, seq DESC LIMIT 50", project_id)
    return ProjectDetail(project=project, items=by_next_at(items), snapshot=db.snapshot_of(project_id),
                         records=[db.record_of(r) for r in records])


@app.put("/projects/{project_id}", response_model=Project)
async def project_put(project_id: str, body: ProjectPutIn, r: str = Depends(auth.runners)):
    """New projects come only as proposed (Orca repos found by sync); existing projects may be
    changed freely, with a change record and undo."""
    old = db.one("SELECT * FROM projects WHERE id = ?", project_id)
    if body.goal_id is not None:
        require_ref("goals", body.goal_id)
    if old is None and body.status != "proposed":
        raise HTTPException(403, "new projects are created as proposed here (POST /projects creates active ones)")
    at = db.now()
    with conn:
        if old is None:
            db.insert_project(ProjectCreateIn(id=project_id, title=body.title, area=body.area,
                                              repo_path=body.repo_path, goal_id=body.goal_id), "proposed")
        else:
            conn.execute("UPDATE projects SET title = ?, area = ?, status = ?, repo_path = ?, goal_id = ? WHERE id = ?",
                         (body.title, body.area, body.status, body.repo_path, body.goal_id, project_id))
            changes.record("project", project_id, old, at, author="system", source=auth.SOURCE_OF[r])
    return db.project_of(get_or_404("projects", project_id), at)


@app.put("/projects/{project_id}/overview", response_model=Project)
async def project_overview(project_id: str, body: ProjectOverview, r: str = Depends(auth.runners)):
    """api.md 项目概况: full overwrite by the worker (each project's overview.json on sync, refresh) or the agent (chat)."""
    get_or_404("projects", project_id)
    at = db.now()
    with conn:
        changes.set_overview(project_id, body, at, author="system", source=auth.SOURCE_OF[r])
    return db.project_of(get_or_404("projects", project_id), at)


@app.put("/projects/{project_id}/snapshot", response_model=Snapshot, dependencies=[Depends(auth.worker)])
async def project_snapshot(project_id: str, body: Snapshot):
    get_or_404("projects", project_id)
    with conn:
        conn.execute("INSERT OR REPLACE INTO project_snapshots (project_id, snapshot) VALUES (?, ?)",
                     (project_id, body.model_dump_json()))
    return db.snapshot_of(project_id)


@app.put("/projects/{project_id}/summary", response_model=Project, dependencies=[Depends(auth.worker)])
async def project_summary(project_id: str, body: ProjectSummaryIn):
    get_or_404("projects", project_id)
    at = db.now()
    with conn:
        conn.execute("UPDATE projects SET summary = ?, summary_evidence = ?, summary_at = ? WHERE id = ?",
                     (body.summary, body.summary_evidence, db.ts(at), project_id))
    return db.project_of(get_or_404("projects", project_id), at)


# action → (allowed current statuses, new status, record title prefix)
PROJECT_DECISIONS = {
    "approve": (("proposed",), "active", "project_approve"),
    "decline": (("proposed",), "declined", "project_decline"),
    "pause": (("active",), "paused", "project_pause"),
    "resume": (("paused",), "active", "project_resume"),
    "done": (("active", "paused"), "done", "project_done"),
}


@app.post("/projects/{project_id}/decision", response_model=Project, dependencies=[Depends(auth.app_write)])
async def project_decision(project_id: str, body: ProjectDecisionIn):
    row = get_or_404("projects", project_id)
    allowed, new_status, title = PROJECT_DECISIONS[body.action]
    if row["status"] not in allowed:
        raise HTTPException(409, f"project {project_id} is {row['status']}; {body.action} needs {' or '.join(allowed)}")
    at = db.now()
    with conn:
        conn.execute("UPDATE projects SET status = ? WHERE id = ?", (new_status, project_id))
        changes.log_changes("project", project_id, row, at)
        db.insert_record(
            at=at, author="me", source="app", kind="decision", tier="log", item_id=None,
            project_id=project_id, title=labels.titled(labels.t(title), row["title"]),
            body=labels.entity_change("project", "status", row["status"], new_status), evidence=None, needs_processing=False, undo=None, card_id=None, category=None, smoke=False,
        )
    return db.project_of(get_or_404("projects", project_id), at)


@app.post("/projects", response_model=Project, dependencies=[Depends(auth.project_creators)])
async def project_create(body: ProjectCreateIn):
    if db.exists("projects", body.id):
        raise HTTPException(409, f"project {body.id} already exists")
    if body.goal_id is not None:
        require_ref("goals", body.goal_id)
    with conn:
        db.insert_project(body, "active")
    return db.project_of(get_or_404("projects", body.id), db.now())


# ---- usage log and authorization status ----

@app.post("/usage", status_code=204, dependencies=[Depends(auth.app_write)])
async def usage_log(body: UsageIn):
    with conn:
        conn.executemany(
            "INSERT INTO usage (at, kind, name, detail) VALUES (?, ?, ?, ?)",
            [(db.ts(e.at), e.kind, e.name, None if e.detail is None else json.dumps(e.detail))
             for e in body.events],
        )
    return Response(status_code=204)


@app.get("/usage/summary", response_model=UsageSummary, dependencies=[Depends(auth.app_read)])
async def usage_summary(from_: date = Query(alias="from"), to: date = Query()):
    if from_ > to:
        raise HTTPException(422, "from is after to")
    rows = db.all_("SELECT at, kind, name FROM usage WHERE at >= ? AND at < ?",
                   db.local_day_bounds(from_)[0], db.local_day_bounds(to)[1])
    views = Counter(r["name"] for r in rows if r["kind"] == "view")
    actions = Counter(r["name"] for r in rows if r["kind"] == "action")
    days = {db.local_today(db.parse(r["at"])) for r in rows}
    unused = [n for n in USAGE_VIEWS if n not in views] + [n for n in USAGE_ACTIONS if n not in actions]
    return UsageSummary(views=dict(views), actions=dict(actions), days_active=len(days), unused=unused)


def auth_status_of(row) -> AuthStatus:
    return AuthStatus(name=row["name"], ok=bool(row["ok"]), detail=row["detail"],
                      checked_at=db.parse(row["checked_at"]))


@app.put("/auth-status/{name}", response_model=AuthStatus)
async def auth_status_put(name: AuthName, body: AuthStatusIn, r: str = Depends(auth.runners)):
    if auth.AUTH_REPORTER[name] != r:
        raise HTTPException(403, f"{name} is reported by {auth.AUTH_REPORTER[name]}, not {r}")
    old = db.one("SELECT ok FROM auth_status WHERE name = ?", name)
    # Never reported counts as ok, so a first failing check still raises the alarm.
    was_ok = old is None or bool(old["ok"])
    at = db.now()
    rec = None
    with conn:
        conn.execute("INSERT OR REPLACE INTO auth_status (name, ok, detail, checked_at) VALUES (?, ?, ?, ?)",
                     (name, int(body.ok), body.detail, db.ts(at)))
        if was_ok and not body.ok:
            rec = db.insert_record(
                at=at, author="system", source="hub", kind="alert", tier="interrupt", item_id=None,
                project_id=None, title=labels.t("auth_lost", x=labels.name("auth", name)),
                body=labels.t("auth_lost_body", x=labels.name("auth", name), detail=body.detail),
                evidence=None, needs_processing=False, undo=None, card_id=None, category=None, smoke=False,
            )
        elif not was_ok and body.ok:
            rec = db.insert_record(
                at=at, author="system", source="hub", kind="log", tier="digest", item_id=None,
                project_id=None, title=labels.t("auth_back", x=labels.name("auth", name)),
                body=labels.t("auth_back_body", x=labels.name("auth", name)),
                evidence=None, needs_processing=False, undo=None, card_id=None, category=None, smoke=False,
            )
    if rec is not None:
        push(rec)
    return auth_status_of(db.one("SELECT * FROM auth_status WHERE name = ?", name))


@app.get("/auth-status", response_model=AuthStatusList, dependencies=[Depends(auth.app_read)])
async def auth_status_list():
    return AuthStatusList(auth=[auth_status_of(r) for r in db.all_("SELECT * FROM auth_status ORDER BY name")])


# ---- feed cards ----

@app.post("/cards", response_model=Card)
async def card_create(body: CardIn, r: str = Depends(auth.card_writers)):
    """A kind=alert card (lab watch) also gets a pushed news record pointing at it."""
    if body.project_id is not None:
        require_ref("projects", body.project_id)
    if db.one("SELECT 1 FROM cards WHERE origin = ? AND dedupe_key = ?", body.origin, body.dedupe_key):
        raise HTTPException(409, f"card {body.origin}/{body.dedupe_key} already exists")
    if body.image_attachment_id is not None:
        att = db.one("SELECT record_id, message_id FROM attachments WHERE id = ?", body.image_attachment_id)
        if att is None:
            raise HTTPException(422, f"attachment {body.image_attachment_id} does not exist")
        if (att["record_id"] is not None or att["message_id"] is not None
                or db.one("SELECT 1 FROM cards WHERE image_attachment_id = ?", body.image_attachment_id)):
            raise HTTPException(422, f"attachment {body.image_attachment_id} is already used")
    cid = db.new_id("c")
    at = db.now()
    rec = None
    with conn:
        conn.execute(
            'INSERT INTO cards (id, at, source, origin, kind, project_id, title, summary, body, link, dedupe_key,'
            " status, item_id, image_attachment_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', NULL, ?)",
            (cid, db.ts(at), auth.SOURCE_OF[r] if r in auth.SOURCE_OF else r.removeprefix("source:"),
             body.origin, body.kind, body.project_id, body.title, body.summary, body.body, body.link, body.dedupe_key,
             body.image_attachment_id),
        )
        if body.kind == "alert":
            rec = db.insert_record(
                at=at, author="system", source="hub", kind="log", tier="digest", item_id=None,
                project_id=body.project_id, title=labels.t("news", x=body.title), body=body.summary,
                evidence=body.link, needs_processing=False, undo=None, card_id=cid, category="news", smoke=False,
            )
    if rec is not None:
        push(rec)
    return db.card_of(get_or_404("cards", cid))


@app.get("/cards/{card_id}", response_model=Card, dependencies=[Depends(auth.app_read)])
async def card_get(card_id: str):
    return db.card_of(get_or_404("cards", card_id))


@app.get("/cards", response_model=CardList, dependencies=[Depends(auth.app_read)])
async def cards(limit: int = Query(gt=0, le=500), before: str | None = None,
                status: CardStatus | None = None, project_id: str | None = None):
    statuses = ("new", "saved") if status is None else (status,)
    where, args = [f"status IN ({', '.join('?' * len(statuses))})"], list(statuses)
    if before is not None:
        b = get_or_404("cards", before)
        where.append("(at < ? OR (at = ? AND seq < ?))")
        args += [b["at"], b["at"], b["seq"]]
    if project_id is not None:
        where.append("project_id = ?")
        args.append(project_id)
    rows = db.all_(f"SELECT * FROM cards WHERE {' AND '.join(where)} ORDER BY at DESC, seq DESC LIMIT ?",
                   *args, limit)
    read = db.one("SELECT card_id FROM card_reads WHERE id = 1")
    return CardList(cards=[db.card_of(r) for r in rows], last_read_id=None if read is None else read["card_id"])


@app.post("/cards/{card_id}/status", response_model=Card, dependencies=[Depends(auth.app_or_runners)])
async def card_status(card_id: str, body: CardStatusIn):
    get_or_404("cards", card_id)
    with conn:
        conn.execute("UPDATE cards SET status = ? WHERE id = ?", (body.status, card_id))
    return db.card_of(get_or_404("cards", card_id))


@app.post("/card-reads", status_code=204, dependencies=[Depends(auth.app_write)])
async def card_read_mark(body: CardReadIn):
    require_ref("cards", body.card_id)
    with conn:
        conn.execute("INSERT OR REPLACE INTO card_reads (id, card_id) VALUES (1, ?)", (body.card_id,))
    return Response(status_code=204)


@app.post("/cards/{card_id}/to-item", response_model=Job, dependencies=[Depends(auth.app_write)])
async def card_to_item(card_id: str):
    card = get_or_404("cards", card_id)
    if card["item_id"] is not None:
        raise HTTPException(409, f"card {card_id} is already item {card['item_id']}")
    if db.one("SELECT 1 FROM jobs j JOIN records r ON r.id = j.record_id WHERE j.kind = 'process_note'"
              " AND j.status IN ('queued', 'running') AND r.card_id = ?", card_id):
        raise HTTPException(409, f"card {card_id} is already being turned into an item")
    body = f"{card['title']}\n\n{card['summary']}" + ("" if card["link"] is None else f"\n\n{card['link']}")
    at = db.now()
    with conn:
        rec = db.insert_record(
            at=at, author="me", source="app", kind="note", tier="log", item_id=None,
            project_id=card["project_id"], title=labels.t("to_item", x=card["title"])[:CHAT_TITLE_CHARS], body=body,
            evidence=card["link"], needs_processing=True, undo=None, card_id=card_id, category=None, smoke=False,
        )
        return db.insert_job(kind="process_note", runner="mac", record_id=rec.id, payload=None, at=at)


# ---- feedback (api.md 反馈与自动修复) ----

FEEDBACK_DONE_TITLE = {"shipped": "feedback_shipped", "declined": "feedback_declined"}  # labels keys


@app.post("/feedback", response_model=Feedback)
async def feedback_create(body: FeedbackIn, r: str = Depends(auth.app_or_agent)):
    """The app, or the agent on the user's behalf when a chat message is a suggestion for
    mojito (it may pass that message's images)."""
    to_copy = check_attachments(body.body, body.attachment_ids, reuse_chat_images=True)
    attachment_ids = await own_attachments(body.attachment_ids, to_copy)
    at = db.now()
    fid = db.new_id("f")
    with conn:
        rec = db.insert_record(
            at=at, author="me", source=auth.actor(r)[1], kind="feedback",
            tier="log", item_id=None, project_id=None,
            title=body.body[:CHAT_TITLE_CHARS] if body.body != "" else labels.t("image"), body=body.body,
            evidence=None, needs_processing=False, undo=None, card_id=None, category=None, smoke=False,
        )
        conn.execute("UPDATE records SET feedback_id = ? WHERE id = ?", (fid, rec.id))
        conn.executemany("UPDATE attachments SET record_id = ? WHERE id = ?",
                         [(rec.id, aid) for aid in attachment_ids])
        conn.execute(
            "INSERT INTO feedback (id, at, body, context, status, ship_mode, summary, updated_at, record_id)"
            " VALUES (?, ?, ?, ?, 'open', NULL, NULL, ?, ?)",
            (fid, db.ts(at), body.body, body.context.model_dump_json(), db.ts(at), rec.id),
        )
    return db.feedback_of(get_or_404("feedback", fid))


@app.get("/feedback", response_model=FeedbackList, dependencies=[Depends(auth.app_get)])
async def feedback_list(status: FeedbackStatus | None = None):
    if status is None:
        rows = db.all_("SELECT * FROM feedback ORDER BY at DESC, seq DESC")
    else:
        rows = db.all_("SELECT * FROM feedback WHERE status = ? ORDER BY at DESC, seq DESC", status)
    return FeedbackList(feedback=[db.feedback_of(r) for r in rows])


@app.get("/feedback/{feedback_id}", response_model=Feedback, dependencies=[Depends(auth.app_get)])
async def feedback_get(feedback_id: str):
    return db.feedback_of(get_or_404("feedback", feedback_id))


@app.put("/feedback/{feedback_id}", response_model=Feedback, dependencies=[Depends(auth.maintainer)])
async def feedback_put(feedback_id: str, body: FeedbackPutIn):
    """Moving to shipped/declined writes a digest record (pushed) whose body is the summary."""
    row = get_or_404("feedback", feedback_id)
    finishing = body.status in FEEDBACK_DONE_TITLE and body.status != row["status"]
    if finishing and body.summary is None:
        raise HTTPException(422, f"summary is required when feedback becomes {body.status}")
    at = db.now()
    rec = None
    with conn:
        conn.execute("UPDATE feedback SET status = ?, ship_mode = ?, summary = ?, updated_at = ? WHERE id = ?",
                     (body.status, body.ship_mode, body.summary, db.ts(at), feedback_id))
        if finishing:
            what = row["body"][:CHAT_TITLE_CHARS] if row["body"] != "" else labels.t("image")
            rec = db.insert_record(
                at=at, author="system", source="maintainer", kind="feedback", tier="digest", item_id=None,
                project_id=None, title=labels.titled(labels.t(FEEDBACK_DONE_TITLE[body.status]), what), body=body.summary,
                evidence=None, needs_processing=False, undo=None, card_id=None, category=None, smoke=False,
            )
    if rec is not None:
        push(rec)
    return db.feedback_of(get_or_404("feedback", feedback_id))


@app.post("/feedback/{feedback_id}/decision", response_model=Feedback, dependencies=[Depends(auth.app_write)])
async def feedback_decision(feedback_id: str, body: FeedbackDecisionIn):
    row = get_or_404("feedback", feedback_id)
    if row["status"] != "awaiting_approval":
        raise HTTPException(409, f"feedback {feedback_id} is {row['status']}, not awaiting_approval")
    new_status = {"approve": "fixing", "decline": "declined"}[body.action]
    at = db.now()
    what = row["body"][:CHAT_TITLE_CHARS] if row["body"] != "" else labels.t("image")
    with conn:
        conn.execute("UPDATE feedback SET status = ?, updated_at = ? WHERE id = ?", (new_status, db.ts(at), feedback_id))
        db.insert_record(
            at=at, author="me", source="app", kind="decision", tier="log", item_id=None, project_id=None,
            title=labels.t(f"feedback_{body.action}", x=what),
            body=labels.t(f"feedback_{body.action}_body"),
            evidence=None, needs_processing=False, undo=None, card_id=None, category=None, smoke=False,
        )
    return db.feedback_of(get_or_404("feedback", feedback_id))


# ---- taste notes (paper feed preferences) ----

@app.get("/taste", response_model=TasteNoteList, dependencies=[Depends(auth.app_read)])
async def taste_list():
    rows = db.all_("SELECT * FROM taste_notes WHERE retired_at IS NULL ORDER BY at DESC, seq DESC")
    return TasteNoteList(notes=[db.taste_note_of(r) for r in rows])


@app.post("/taste", response_model=TasteNote)
async def taste_add(body: TasteNoteIn, r: str = Depends(auth.runners)):
    tid = db.new_id("t")
    with conn:
        conn.execute("INSERT INTO taste_notes (id, at, text, source, retired_at) VALUES (?, ?, ?, ?, NULL)",
                     (tid, db.ts(db.now()), body.text, auth.SOURCE_OF[r]))
    return db.taste_note_of(get_or_404("taste_notes", tid))


@app.post("/taste/{note_id}/retire", response_model=TasteNote, dependencies=[Depends(auth.app_or_agent)])
async def taste_retire(note_id: str):
    row = get_or_404("taste_notes", note_id)
    if row["retired_at"] is not None:
        raise HTTPException(409, f"taste note {note_id} is already retired")
    with conn:
        conn.execute("UPDATE taste_notes SET retired_at = ? WHERE id = ?", (db.ts(db.now()), note_id))
    return db.taste_note_of(row)


# ---- in-chat edits of goals, plans and note links (with change records and undo) ----

@app.put("/goals/{goal_id}", response_model=Goal)
async def goal_put(goal_id: str, body: GoalPutIn, r: str = Depends(auth.runners)):
    old = db.one("SELECT * FROM goals WHERE id = ?", goal_id)
    at = db.now()
    with conn:
        if old is None:
            conn.execute("INSERT INTO goals (id, title, status) VALUES (?, ?, ?)", (goal_id, body.title, body.status))
        else:
            conn.execute("UPDATE goals SET title = ?, status = ? WHERE id = ?", (body.title, body.status, goal_id))
            changes.record("goal", goal_id, old, at, author="system", source=auth.SOURCE_OF[r])
    return db.goal_of(get_or_404("goals", goal_id))


@app.put("/plans/{plan_id}", response_model=Plan)
async def plan_put(plan_id: str, body: PlanPutIn, r: str = Depends(auth.runners)):
    """Direct edit of an active or draft plan (what the user asked for in chat)."""
    old = get_or_404("plans", plan_id)
    if old["status"] not in ("active", "draft"):
        raise HTTPException(409, f"plan {plan_id} is {old['status']}; only active or draft plans can be edited")
    if body.start > body.end:
        raise HTTPException(422, "start is after end")
    for g in body.goal_ids:
        require_ref("goals", g)
    for i in body.item_ids:
        require_ref("items", i)
    at = db.now()
    with conn:
        conn.execute('UPDATE plans SET start = ?, "end" = ?, goal_ids = ?, item_ids = ? WHERE id = ?',
                     (body.start.isoformat(), body.end.isoformat(), json.dumps(body.goal_ids),
                      json.dumps(body.item_ids), plan_id))
        changes.record("plan", plan_id, old, at, author="system", source=auth.SOURCE_OF[r])
    return db.plan_of(get_or_404("plans", plan_id))


@app.post("/records/{record_id}/link", response_model=Record)
async def record_link(record_id: str, body: NoteLinkIn, r: str = Depends(auth.app_or_runners)):
    """The only way a record's item_id/project_id changes: the user's own notes. With an item,
    the note takes the item's project (as on write)."""
    old = get_or_404("records", record_id)
    if old["kind"] != "note" or old["author"] != "me":
        raise HTTPException(409, f"record {record_id} is not your note; only notes can be re-linked")
    if body.item_id is not None:
        require_ref("items", body.item_id)
        project_id = db.one("SELECT project_id FROM items WHERE id = ?", body.item_id)["project_id"]
    else:
        if body.project_id is not None:
            require_ref("projects", body.project_id)
        project_id = body.project_id
    at = db.now()
    author, source = auth.actor(r)
    with conn:
        conn.execute("UPDATE records SET item_id = ?, project_id = ? WHERE id = ?", (body.item_id, project_id, record_id))
        changes.record("note", record_id, old, at, author=author, source=source)
    return db.record_of(get_or_404("records", record_id))


# ---- feedback threads ----

@app.get("/feedback/{feedback_id}/messages", response_model=FeedbackMessageList,
         dependencies=[Depends(auth.feedback_talkers)])
async def feedback_messages(feedback_id: str):
    get_or_404("feedback", feedback_id)
    rows = db.all_("SELECT * FROM feedback_messages WHERE feedback_id = ? ORDER BY seq", feedback_id)
    return FeedbackMessageList(messages=[db.feedback_message_of(m) for m in rows])


@app.post("/feedback/{feedback_id}/messages", response_model=FeedbackMessage)
async def feedback_message_add(feedback_id: str, body: FeedbackMessageIn, r: str = Depends(auth.feedback_talkers)):
    """maintainer → author maintainer, and a chat record (tier digest, pushed) so the user sees
    it in chat; app / agent (relaying the user's chat reply) → author me."""
    feedback = get_or_404("feedback", feedback_id)
    to_copy = check_attachments(body.body, body.attachment_ids, reuse_chat_images=r == "agent")
    attachment_ids = await own_attachments(body.attachment_ids, to_copy)
    at = db.now()
    mid = db.new_id("m")
    author = "maintainer" if r == "maintainer" else "me"
    rec = None
    with conn:
        conn.execute("INSERT INTO feedback_messages (id, feedback_id, at, author, body) VALUES (?, ?, ?, ?, ?)",
                     (mid, feedback_id, db.ts(at), author, body.body))
        conn.executemany("UPDATE attachments SET message_id = ? WHERE id = ?", [(mid, aid) for aid in attachment_ids])
        if author == "maintainer":
            about = feedback["body"][:20] if feedback["body"] != "" else labels.t("image")
            rec = db.insert_record(
                at=at, author="system", source="maintainer", kind="chat", tier="digest", item_id=None,
                project_id=None, title=body.body[:CHAT_TITLE_CHARS] if body.body != "" else labels.t("image"),
                body=f"{labels.t('feedback_message_prefix', x=about)}\n{body.body}", evidence=None, needs_processing=False,
                undo=None, card_id=None, category=None, smoke=False,
            )
            conn.execute("UPDATE records SET feedback_id = ? WHERE id = ?", (feedback_id, rec.id))
    if rec is not None:
        push(db.record_of(get_or_404("records", rec.id)))
    return db.feedback_message_of(get_or_404("feedback_messages", mid))


# ---- source result health, metrics ----

@app.post("/sources/{name}/health", response_model=Source)
async def source_health(name: str, body: SourceHealthIn, src: str = Depends(auth.source), r: str = Depends(auth.role)):
    """By the source itself, or by the worker for its task-type sources (feed-papers,
    sync-projects). The source must have sent a heartbeat first (that is what registers it)."""
    if not auth.may_report_for(r, src, name):
        raise HTTPException(403, f"token is for source {src}, not {name}")
    get_source_or_404(name)
    at = db.now()
    health.report(name, body.health, body.detail, at)
    return db.source_of(get_source_or_404(name), at)


def get_source_or_404(name: str):
    row = db.one("SELECT * FROM sources WHERE name = ?", name)
    if row is None:
        raise HTTPException(404, f"source {name} is not registered (send a heartbeat first)")
    return row


# The evening prompt's fixed titles (api.md v2a 早晚通知; English per 界面语言).
EVENING_QUESTIONS = ("今天推进了什么？", "What did you move forward today?")
REPLY_UNTIL = time(4, 0)  # a reply counts until 04:00 local the next morning


@app.get("/metrics", response_model=Metrics, dependencies=[Depends(auth.app_read)])
async def metrics(from_: date = Query(alias="from"), to: date = Query()):
    if from_ > to:
        raise HTTPException(422, "from is after to")
    days = []
    day = from_
    while day <= to:
        start, end = db.local_day_bounds(day)
        opens = db.one("SELECT COUNT(*) AS n FROM usage WHERE kind = 'view' AND name = 'app_open' AND at >= ? AND at < ?",
                       start, end)["n"]
        asked = db.all_("SELECT at FROM records WHERE kind = 'chat' AND author = 'system' AND title IN (?, ?)"
                        " AND smoke = 0 AND at >= ? AND at < ? ORDER BY at", *EVENING_QUESTIONS, start, end)
        replied = 0
        if asked:
            until = db.ts(datetime.combine(day + timedelta(days=1), REPLY_UNTIL, db.DAY_TZ))
            replied = int(db.one("SELECT 1 FROM records WHERE author = 'me' AND kind IN ('chat', 'note')"
                                 " AND smoke = 0 AND at > ? AND at < ? LIMIT 1", asked[0]["at"], until) is not None)
        days.append(MetricsDay(date=day, opens=opens, evening_asked=int(bool(asked)), evening_replied=replied))
        day += timedelta(days=1)
    return Metrics(days=days, totals=MetricsTotals(opens=sum(d.opens for d in days),
                                                   evening_asked=sum(d.evening_asked for d in days),
                                                   evening_replied=sum(d.evening_replied for d in days)))


@app.post("/records/{record_id}/hide", response_model=Record, dependencies=[Depends(auth.app_write)])
async def record_hide(record_id: str):
    """Delete a note from the user's view; the record itself stays (records are append-only)."""
    row = get_or_404("records", record_id)
    if row["kind"] != "note" or row["author"] != "me":
        raise HTTPException(409, f"record {record_id} is not your note; only notes can be hidden")
    if row["hidden_at"] is not None:
        raise HTTPException(409, f"record {record_id} is already hidden")
    with conn:
        conn.execute("UPDATE records SET hidden_at = ? WHERE id = ?", (db.ts(db.now()), record_id))
    return db.record_of(get_or_404("records", record_id))


# ---- Mac app polling (api.md Mac app 取新事件) ----

PUSHED_TIERS = ("interrupt", "digest", "quiet")


@app.get("/pulse", response_model=Pulse, dependencies=[Depends(auth.app_write)])
async def pulse(limit: int = Query(ge=1, le=100), after: str | None = None):
    """New pushable records after the cursor (a record seq) plus menu-bar counts. Without a
    cursor: no records, just the current cursor, so history is not shown as new."""
    at = db.now()
    today = build_today(at)
    needs = today.needs_you
    counts = PulseCounts(
        due_today=sum(1 for i in today.focus if i.days_until == 0),
        needs_you=len(needs.items) + len(needs.plans) + len(needs.drafts) + len(needs.projects) + len(needs.feedback),
    )
    last_seq = db.one("SELECT COALESCE(MAX(seq), 0) AS s FROM records")["s"]
    if after is None:
        return Pulse(cursor=str(last_seq), records=[], more=False, counts=counts)
    if not after.isdigit():
        raise HTTPException(422, "after must be a cursor returned by /pulse")
    rows = db.all_(
        f"SELECT * FROM records WHERE seq > ? AND tier IN ({', '.join('?' * len(PUSHED_TIERS))})"
        " AND hidden_at IS NULL AND smoke = 0 ORDER BY seq LIMIT ?",
        int(after), *PUSHED_TIERS, limit + 1,
    )
    page = rows[:limit]
    # The cursor moves past everything scanned: to the last returned record, or to the end.
    cursor = page[-1]["seq"] if len(rows) > limit else last_seq
    return Pulse(cursor=str(cursor), records=[db.record_of(r) for r in page], more=len(rows) > limit, counts=counts)


# ---- calendar delete, subscriptions (api.md 删日程、订阅、每日邮件) ----

@app.post("/calendar/{uid}/delete", response_model=Job, dependencies=[Depends(auth.app_write)])
async def calendar_delete(uid: str, body: CalendarDeleteIn):
    """One occurrence of a main-calendar event (uid + start); the agent deletes it via the Google
    API and writes an undoable record. Subscribed calendars are read-only (api.md 订阅日历)."""
    start = db.ts(body.start)
    event = db.one("SELECT read_only FROM calendar_events WHERE uid = ? AND start = ?", uid, start)
    if event is None:
        raise HTTPException(404, f"calendar event {uid} at {start} not found")
    if event["read_only"]:
        raise HTTPException(409, "这是订阅来的日历，只能在原日历里改")
    with conn:
        return db.insert_job(kind="calendar_delete", runner="server", record_id=None,
                             payload={"uid": uid, "start": start}, at=db.now())


@app.get("/subscriptions", response_model=SubscriptionList, dependencies=[Depends(auth.app_read)])
async def subscriptions():
    return SubscriptionList(subscriptions=[db.subscription_of(r) for r in db.all_("SELECT * FROM subscriptions ORDER BY at")])


@app.post("/subscriptions/{sub_id}/enabled", response_model=Subscription)
async def subscription_enabled(sub_id: str, body: SubscriptionEnabledIn, r: str = Depends(auth.subscription_togglers)):
    old = get_or_404("subscriptions", sub_id)
    at = db.now()
    author, source = auth.actor(r)
    with conn:
        conn.execute("UPDATE subscriptions SET enabled = ? WHERE id = ?", (int(body.enabled), sub_id))
        changes.record("subscription", sub_id, old, at, author=author, source=source)
    return db.subscription_of(get_or_404("subscriptions", sub_id))


@app.put("/subscriptions/{sub_id}", response_model=Subscription)
async def subscription_put(sub_id: str, body: SubscriptionPutIn, r: str = Depends(auth.runners)):
    """config must have the shape of the subscription's kind (the watchdog schedules from it)."""
    old = get_or_404("subscriptions", sub_id)
    try:
        config = SUBSCRIPTION_CONFIG[old["kind"]].model_validate(body.config)
    except ValidationError as e:
        raise HTTPException(422, f"config of a {old['kind']} subscription: {e.errors(include_input=False)}") from e
    at = db.now()
    with conn:
        conn.execute("UPDATE subscriptions SET at = ?, config = ? WHERE id = ?",
                     (body.at, json.dumps(config.model_dump(), ensure_ascii=False), sub_id))
        changes.record("subscription", sub_id, old, at, author="system", source=auth.SOURCE_OF[r])
    return db.subscription_of(get_or_404("subscriptions", sub_id))


@app.post("/subscriptions/{sub_id}/result", response_model=Subscription, dependencies=[Depends(auth.worker)])
async def subscription_result(sub_id: str, body: SubscriptionResultIn):
    get_or_404("subscriptions", sub_id)
    health.report_subscription(sub_id, body.result, body.health, db.now())
    return db.subscription_of(get_or_404("subscriptions", sub_id))


@app.post("/subscriptions/{sub_id}/run", response_model=Job, dependencies=[Depends(auth.subscription_runners)])
async def subscription_run(sub_id: str):
    """The subscriptions page's "run now" (also from chat): regardless of enabled."""
    sub = get_or_404("subscriptions", sub_id)
    return start_job_now(watchdog.SUBSCRIPTION_JOB[sub["kind"]])


# ---- Web Push subscriptions (api.md iPhone 网页版) ----

MAX_WEBPUSH_SUBSCRIPTIONS = 20
USER_AGENT_CHARS = 200


@app.get("/webpush/vapid-public-key", response_model=VapidPublicKey, dependencies=[Depends(auth.app_token_ref)])
async def vapid_public_key():
    return VapidPublicKey(public_key=config.VAPID_PUBLIC_KEY)


@app.post("/webpush/subscriptions", status_code=204)
async def webpush_subscribe(body: WebPushSubscriptionIn, user_agent: str = Header(),
                            ref: str = Depends(auth.app_token_ref)):
    """Upsert by endpoint (keys, token_ref, user agent updated; registered_at kept)."""
    exists = db.one("SELECT 1 FROM webpush_subscriptions WHERE endpoint = ?", body.endpoint)
    if exists is None:
        count = db.one("SELECT COUNT(*) AS n FROM webpush_subscriptions")["n"]
        if count >= MAX_WEBPUSH_SUBSCRIPTIONS:
            raise HTTPException(422, f"at most {MAX_WEBPUSH_SUBSCRIPTIONS} push subscriptions")
    with conn:
        conn.execute(
            "INSERT INTO webpush_subscriptions (endpoint, p256dh, auth, token_ref, user_agent, registered_at)"
            " VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (endpoint) DO UPDATE SET p256dh = excluded.p256dh,"
            " auth = excluded.auth, token_ref = excluded.token_ref, user_agent = excluded.user_agent",
            (body.endpoint, body.keys.p256dh, body.keys.auth, ref, user_agent[:USER_AGENT_CHARS], db.ts(db.now())),
        )
    return Response(status_code=204)


@app.post("/webpush/subscriptions/delete", status_code=204, dependencies=[Depends(auth.app_token_ref)])
async def webpush_unsubscribe(body: WebPushEndpointIn):
    """Idempotent; the endpoint travels in the body so it stays out of access logs."""
    with conn:
        conn.execute("DELETE FROM webpush_subscriptions WHERE endpoint = ?", (body.endpoint,))
    return Response(status_code=204)
