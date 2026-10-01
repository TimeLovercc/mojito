"""API objects (docs/api.md). Request bodies ignore unknown fields (logged, api.md 兼容规则)
and have no defaults except where api.md marks a field optional."""

import base64
import logging
from contextvars import ContextVar
from datetime import date, datetime
from typing import Annotated, Any, Literal
from urllib.parse import urlsplit

from pydantic import (
    AwareDatetime, BaseModel, ConfigDict, Field, PositiveInt, StringConstraints, field_validator, model_validator,
)

# "METHOD /path" of the request being handled (set by middleware; "startup" during lifespan),
# so ignored-field warnings can say where they came from.
request_path: ContextVar[str] = ContextVar("request_path")
log = logging.getLogger("mojito_hub.api")


class Body(BaseModel):
    """Base of request bodies: unknown fields are dropped with a warning (names only, never
    values), so an app that already sends a newer field keeps working against an older hub.
    Missing required fields are still 422."""
    model_config = ConfigDict(extra="ignore")

    @model_validator(mode="before")
    @classmethod
    def _warn_unknown(cls, data: Any) -> Any:
        if isinstance(data, dict):
            unknown = sorted(set(data) - set(cls.model_fields))
            if unknown:
                log.warning("%s: ignored unknown field(s) %s in %s", request_path.get(), ", ".join(unknown),
                            cls.__name__)
        return data


GoalStatus = Literal["active", "done", "dropped"]
PlanStatus = Literal["draft", "active", "closed"]
Category = Literal["research", "life"]
ItemStatus = Literal["active", "waiting_you", "scheduled", "standing", "done", "closed"]
Owner = Literal["auto", "me", "auto_then_me"]
Author = Literal["system", "me"]
RecordKind = Literal["log", "note", "alert", "decision", "chat", "feedback"]
Tier = Literal["interrupt", "digest", "quiet", "log"]
RecordCategory = Literal["brief", "chat", "alert", "feedback", "release", "jobs", "news"]
# draft_plan and feed_arxiv/feed_papers are retired (replaced by draft_review, feed_brief) but stay readable for old rows.
JobKind = Literal["refresh", "process_note", "draft_plan", "chat_reply", "morning_brief",
                  "evening_prompt", "undo", "draft_review", "weekly_summary", "sync_projects",
                  "feed_arxiv", "feed_papers", "feed_weekly", "feed_mail", "calendar_delete",
                  "feed_brief", "feed_watch"]
ProjectStatus = Literal["proposed", "active", "paused", "done", "declined"]

# api.md 使用记录: the two name tables. unused in /usage/summary = names here with count 0.
USAGE_VIEWS = (
    "today", "plan_current", "plan_history", "plan_detail", "projects", "project_detail", "items",
    "item_detail", "timeline", "feed", "card_detail", "chat", "system", "note_sheet", "widget_today",
    "widget_note", "push_open", "notes", "feedback_sheet", "app_open",
)
USAGE_ACTIONS = (
    "note", "decision", "refresh", "chat_send", "item_ask", "undo", "draft_copy", "draft_resolve",
    "review_finish", "review_start", "settings_save", "open_orca", "inline_reply",
    "card_save", "card_dismiss", "card_ask", "card_to_item", "client_error", "feedback_send",
    "feedback_decision", "note_hide", "push_enable", "push_disable",
)
FeedbackStatus = Literal["open", "triaged", "fixing", "awaiting_approval", "shipped", "declined"]
AuthName = Literal["google-calendar-write", "gmail-read", "claude-server", "claude-mac", "x"]
Runner = Literal["server", "mac"]
DraftStatus = Literal["pending", "dismissed", "sent_by_me"]
Clock = Annotated[str, StringConstraints(pattern=r"^([01][0-9]|2[0-3]):[0-5][0-9]$")]
JobStatus = Literal["queued", "running", "done", "failed"]


class Goal(BaseModel):
    id: str
    title: str
    status: GoalStatus


class Plan(BaseModel):
    id: str
    start: date
    end: date
    goal_ids: list[str]
    item_ids: list[str]
    status: PlanStatus
    created_at: datetime | None
    closed_at: datetime | None
    review_status: Literal["none", "draft", "done"]
    revises: str | None  # draft revision of this (active) plan; approving it closes that plan


class Item(BaseModel):
    id: str
    title: str
    category: Category
    status: ItemStatus
    forgotten: bool
    next_step: str
    next_at: datetime | None
    owner: Owner
    done_definition: str
    goal_id: str | None
    project_id: str | None
    progress: dict[str, Any] | None
    updated_at: datetime
    updated_by: str


class Attachment(BaseModel):
    id: str
    content_type: Literal["image/jpeg"]
    bytes: int
    width: int
    height: int
    created_at: datetime


class Record(BaseModel):
    id: str
    at: datetime
    author: Author
    source: str
    kind: RecordKind
    tier: Tier
    item_id: str | None
    project_id: str | None
    title: str
    body: str
    evidence: str | None
    needs_processing: bool
    undo: dict[str, Any] | None
    undone_at: datetime | None
    attachments: list[Attachment]  # images of chat messages and feedback; empty otherwise
    card_id: str | None  # the feed card a chat message asks about / a to-item note came from
    feedback_id: str | None  # the feedback a feedback record or a maintainer chat message belongs to
    hidden_at: datetime | None  # a note the user deleted; left out of lists unless asked for
    category: RecordCategory | None  # notification category of pushed records; null for tier log
    smoke: bool  # deploy smoke check (api.md 冒烟标记): never pushed, left out of lists and metrics


SourceHealth = Literal["ok", "warn", "error"]


class Source(BaseModel):
    name: str
    expected_interval_s: int
    last_seen_at: datetime | None
    alive: bool
    health: SourceHealth | None  # result health reported by the source (or the worker/hub for it)
    health_detail: str | None
    health_at: datetime | None


class Job(BaseModel):
    id: str
    kind: JobKind
    runner: Runner
    record_id: str | None
    payload: dict[str, Any] | None  # kind-specific input, e.g. {uid} for calendar_delete
    status: JobStatus
    requested_at: datetime | None
    started_at: datetime | None
    finished_at: datetime | None
    error: str | None


class Project(BaseModel):
    id: str
    title: str
    area: Category
    status: ProjectStatus
    repo_path: str | None
    goal_id: str | None
    summary: str | None
    summary_evidence: str | None
    summary_at: datetime | None
    last_activity_at: datetime | None
    stale: bool
    open_items: int


class SnapshotWorktree(Body):
    name: str
    branch: str | None
    path: str
    status: str | None  # Orca workspaceStatus
    last_output: Annotated[str, StringConstraints(max_length=200)] | None
    last_activity_at: AwareDatetime | None


class SnapshotCommit(Body):
    repo: str
    sha: str
    subject: str
    at: AwareDatetime


class Snapshot(Body):
    """Latest Orca snapshot of a project; request and response share this shape."""
    taken_at: AwareDatetime
    worktrees: list[SnapshotWorktree]
    commits: Annotated[list[SnapshotCommit], Field(max_length=20)]


CardKind = Literal["paper", "idea", "report", "other", "mail", "post", "brief", "alert"]
CardStatus = Literal["new", "saved", "dismissed"]


class TasteNote(BaseModel):
    id: str
    at: datetime
    text: str
    source: str


class TasteNoteList(BaseModel):
    notes: list[TasteNote]


class TasteNoteIn(Body):
    text: str


class Card(BaseModel):
    id: str
    at: datetime
    source: str
    origin: str
    kind: CardKind
    project_id: str | None
    title: str
    summary: str
    body: str | None  # Markdown full text of report cards (brief / alert)
    link: str | None
    dedupe_key: str
    status: CardStatus
    item_id: str | None
    image_attachment_id: str | None


class Draft(BaseModel):
    id: str
    at: datetime
    source: str
    channel: Literal["email", "message"]
    to: str
    subject: str | None
    body: str
    item_id: str | None
    status: DraftStatus


class Review(BaseModel):
    plan_id: str
    created_at: datetime
    summary: str
    completed_item_ids: list[str]
    missed_item_ids: list[str]
    patterns: list[str]
    user_note: str | None
    status: Literal["draft", "done"]


class Event(BaseModel):
    uid: str
    start: datetime
    end: datetime
    all_day: bool
    title: str
    location: str | None
    read_only: bool  # from a subscribed calendar (api.md 订阅日历): cannot be deleted here


class Notify(Body):
    """Which categories of pushed records reach the phone / Mac (api.md 通知设置)."""
    brief: bool
    chat: bool
    alert: bool
    feedback: bool
    release: bool
    jobs: bool
    news: bool


Language = Literal["zh", "en"]


class Settings(Body):
    morning_at: Clock
    evening_at: Clock
    evening_enabled: bool
    notify: Notify
    language: Language


class SettingsPutIn(Body):
    morning_at: Clock
    evening_at: Clock
    evening_enabled: bool
    notify: Notify | None = None  # added in 8.6: omitted = unchanged
    language: Language | None = None  # added in 8.9: omitted = unchanged


class SeedSettings(Body):
    """settings in MOJITO_SEED: language is required there (api.md 界面语言)."""
    morning_at: Clock
    evening_at: Clock
    evening_enabled: bool
    language: Language


# ---- responses ----

class Feedback(BaseModel):
    id: str
    at: datetime
    body: str
    attachments: list[Attachment]
    context: dict[str, Any]
    status: FeedbackStatus
    ship_mode: Literal["auto", "ask"] | None
    summary: str | None
    updated_at: datetime


class FeedbackMessage(BaseModel):
    id: str
    feedback_id: str
    at: datetime
    author: Literal["me", "maintainer"]
    body: str
    attachments: list[Attachment]


class FeedbackMessageList(BaseModel):
    messages: list[FeedbackMessage]


class FeedbackList(BaseModel):
    feedback: list[Feedback]


class NeedsYou(BaseModel):
    items: list[Item]
    plans: list[Plan]
    drafts: list[Draft]
    projects: list[Project]
    feedback: list[Feedback]


class FocusItem(Item):
    days_until: int  # local days from today to next_at (today = 0); only in /today.focus


class Today(BaseModel):
    generated_at: datetime
    plan: Plan | None
    focus: list[FocusItem]
    needs_you: NeedsYou
    overdue: list[Item]
    forgotten: list[Item]
    alerts: list[Record]
    schedule: list[Event]


class PlanDetail(BaseModel):
    plan: Plan
    goals: list[Goal]
    items: list[Item]
    review: Review | None


class ItemDetail(BaseModel):
    item: Item
    records: list[Record]


class RecordList(BaseModel):
    records: list[Record]
    last_read_id: str | None


class GoalList(BaseModel):
    goals: list[Goal]


class PlanList(BaseModel):
    plans: list[Plan]


class ItemList(BaseModel):
    items: list[Item]


class SourceList(BaseModel):
    sources: list[Source]


class JobList(BaseModel):
    jobs: list[Job]


class EventList(BaseModel):
    events: list[Event]


class ChatList(BaseModel):
    records: list[Record]


class ProjectList(BaseModel):
    projects: list[Project]


class ProjectDetail(BaseModel):
    project: Project
    items: list[Item]
    snapshot: Snapshot | None
    records: list[Record]


class UsageSummary(BaseModel):
    views: dict[str, int]
    actions: dict[str, int]
    days_active: int
    unused: list[str]


class AuthStatus(BaseModel):
    name: AuthName
    ok: bool
    detail: str | None
    checked_at: datetime


class AuthStatusList(BaseModel):
    auth: list[AuthStatus]


class CardList(BaseModel):
    cards: list[Card]
    last_read_id: str | None


class DraftList(BaseModel):
    drafts: list[Draft]


class ChatOut(BaseModel):
    record: Record
    job: Job


# ---- requests ----



class RecordIn(Body):
    title: str
    body: str  # may be "" when attachment_ids is not empty
    item_id: str | None
    project_id: str | None
    needs_processing: bool
    attachment_ids: Annotated[list[str], Field(max_length=4)] = []  # added in 8.6; omitted = no images
    smoke: bool = False  # deploy smoke check; optional


class DecisionIn(Body):
    action: Literal["approve", "decline", "postpone", "done", "close", "reopen"]
    until: AwareDatetime | None = None  # required iff action == postpone


class JobIn(Body):
    kind: Literal["refresh", "draft_review"]


class DeviceIn(Body):
    fcm_token: str


class ReadIn(Body):
    record_id: str


class FinishIn(Body):
    status: Literal["done", "failed"]
    error: str | None = None  # required iff status == failed


class ItemIn(Body):
    title: str
    category: Category
    status: ItemStatus
    next_step: str
    next_at: AwareDatetime | None
    owner: Owner
    done_definition: str
    goal_id: str | None
    project_id: str | None
    progress: dict[str, Any] | None


class PlanIn(Body):
    id: str
    start: date
    end: date
    goal_ids: list[str]
    item_ids: list[str]
    revises: str | None = None  # added later; optional so earlier senders keep working


class ChatIn(Body):
    body: str  # may be "" when attachment_ids is not empty
    item_id: str | None
    project_id: str | None
    attachment_ids: Annotated[list[str], Field(max_length=4)]
    card_id: str | None
    smoke: bool = False  # deploy smoke check; optional


class JobCreateIn(Body):
    kind: JobKind
    runner: Runner
    record_id: str | None


class DraftIn(Body):
    channel: Literal["email", "message"]
    to: str
    subject: str | None
    body: str
    item_id: str | None


class DraftResolveIn(Body):
    status: Literal["dismissed", "sent_by_me"]


class ReviewIn(Body):
    summary: str
    completed_item_ids: list[str]
    missed_item_ids: list[str]
    patterns: list[str]


class ReviewFinishIn(Body):
    user_note: str


class UsageEvent(Body):
    at: AwareDatetime
    kind: Literal["view", "action"]
    name: str
    detail: dict[str, Any] | None

    @model_validator(mode="after")
    def known_name(self):
        names = USAGE_VIEWS if self.kind == "view" else USAGE_ACTIONS
        if self.name not in names:
            raise ValueError(f"unknown {self.kind} name {self.name!r}")
        return self


class UsageIn(Body):
    events: list[UsageEvent]


class AuthStatusIn(Body):
    ok: bool
    detail: str | None


class CardIn(Body):
    origin: str
    kind: CardKind
    project_id: str | None
    title: str
    summary: Annotated[str, StringConstraints(max_length=800)]
    link: Annotated[str, StringConstraints(pattern=r"^https?://")] | None
    dedupe_key: str
    image_attachment_id: str | None = None  # added for post covers; optional for earlier senders
    body: Annotated[str, StringConstraints(max_length=12000)] | None = None  # added for report cards; optional


class CardStatusIn(Body):
    status: CardStatus


class CardReadIn(Body):
    card_id: str


class ItemBefore(Body):
    """`before` of an item undo: original values of the changed fields (api.md B)."""
    next_step: str | None = None
    next_at: AwareDatetime | None = None
    status: ItemStatus | None = None
    owner: Owner | None = None
    title: str | None = None
    project_id: str | None = None


class GoalPutIn(Body):
    title: str
    status: GoalStatus


class PlanPutIn(Body):
    start: date
    end: date
    goal_ids: list[str]
    item_ids: list[str]


class NoteLinkIn(Body):
    item_id: str | None
    project_id: str | None


class ProjectPutIn(Body):
    title: str
    area: Category
    status: ProjectStatus
    repo_path: str | None
    goal_id: str | None


class ProjectCreateIn(Body):
    id: str
    title: str
    area: Category
    repo_path: str | None
    goal_id: str | None


class ProjectSummaryIn(Body):
    summary: str
    summary_evidence: str | None


class ProjectDecisionIn(Body):
    action: Literal["approve", "decline", "pause", "resume", "done"]


class HeartbeatIn(Body):
    expected_interval_s: PositiveInt


class EventIn(Body):
    kind: RecordKind
    tier: Tier
    item_id: str | None
    project_id: str | None
    repo_path: str | None  # resolves project_id when that is null (Orca Stop hook)
    title: str
    body: str
    evidence: str | None
    undo: dict[str, Any] | None = None  # added in v2b; optional so v2a senders keep working
    category: RecordCategory | None = None  # added in 8.6; omitted = inferred by the hub
    smoke: bool = False  # deploy smoke check; optional


class FeedbackContext(Body):
    screen: str | None
    item_id: str | None
    project_id: str | None
    app_update_id: str | None


class FeedbackIn(Body):
    body: str  # may be "" when attachment_ids is not empty
    attachment_ids: Annotated[list[str], Field(max_length=4)]
    context: FeedbackContext


class FeedbackPutIn(Body):
    status: FeedbackStatus
    ship_mode: Literal["auto", "ask"] | None
    summary: str | None


class FeedbackDecisionIn(Body):
    action: Literal["approve", "decline"]


class FeedbackMessageIn(Body):
    body: str  # may be "" when attachment_ids is not empty
    attachment_ids: Annotated[list[str], Field(max_length=4)]


class SourceHealthIn(Body):
    health: SourceHealth
    detail: str | None


class MetricsDay(BaseModel):
    date: date
    opens: int
    evening_asked: int
    evening_replied: int


class MetricsTotals(BaseModel):
    opens: int
    evening_asked: int
    evening_replied: int


class Metrics(BaseModel):
    days: list[MetricsDay]
    totals: MetricsTotals


class PulseCounts(BaseModel):
    due_today: int
    needs_you: int


class Pulse(BaseModel):
    cursor: str
    records: list[Record]
    more: bool
    counts: PulseCounts


SubscriptionKind = Literal["brief", "watch", "mail"]


class SubscriptionConfig(BaseModel):
    """`config` of one subscription kind (api.md 信息流改成报告); a wrong or extra key is a 422,
    never dropped."""
    model_config = ConfigDict(extra="forbid")


class BriefConfig(SubscriptionConfig):
    pass


class WatchConfig(SubscriptionConfig):
    labs: list[str]
    every_hours: Annotated[int, Field(ge=1, le=24)]  # runs start again at `at` every day


class MailConfig(SubscriptionConfig):
    pass


SUBSCRIPTION_CONFIG: dict[str, type[SubscriptionConfig]] = {"brief": BriefConfig, "watch": WatchConfig,
                                                             "mail": MailConfig}


class Subscription(BaseModel):
    id: str
    name: str
    kind: SubscriptionKind
    at: Clock
    enabled: bool
    config: dict[str, Any]
    last_run_at: datetime | None
    last_result: str | None
    health: SourceHealth | None


class SubscriptionList(BaseModel):
    subscriptions: list[Subscription]


class SubscriptionEnabledIn(Body):
    enabled: bool


class SubscriptionPutIn(Body):
    at: Clock
    config: dict[str, Any]


class SubscriptionResultIn(Body):
    result: str
    health: SourceHealth


class CalendarDeleteIn(Body):
    start: AwareDatetime  # which occurrence (the `start` shown by /calendar); a series is never deleted whole


# ---- Web Push (api.md iPhone 网页版) ----

# Push services allowed as subscription endpoints: (host, subdomains allowed).
PUSH_SERVICES = (("push.apple.com", True), ("fcm.googleapis.com", False),
                 ("push.services.mozilla.com", True), ("notify.windows.com", True))


def b64url_decode(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


class WebPushKeys(Body):
    p256dh: str
    auth: str

    @field_validator("p256dh")
    @classmethod
    def _p256dh(cls, v: str) -> str:
        raw = b64url_decode(v)
        if len(raw) != 65 or raw[0] != 0x04:
            raise ValueError("p256dh must be a 65-byte uncompressed P-256 point (base64url)")
        return v

    @field_validator("auth")
    @classmethod
    def _auth(cls, v: str) -> str:
        if len(b64url_decode(v)) != 16:
            raise ValueError("auth must be 16 bytes (base64url)")
        return v


class WebPushSubscriptionIn(Body):
    endpoint: str
    keys: WebPushKeys

    @field_validator("endpoint")
    @classmethod
    def _endpoint(cls, v: str) -> str:
        parts = urlsplit(v)
        host = (parts.hostname or "").lower()
        if parts.scheme != "https" or parts.username is not None or parts.password is not None:
            raise ValueError("endpoint must be https without userinfo")
        if parts.port not in (None, 443):
            raise ValueError("endpoint port must be 443")
        if not any(host == h or (sub and host.endswith("." + h)) for h, sub in PUSH_SERVICES):
            raise ValueError("endpoint host is not a known push service")
        return v


class WebPushEndpointIn(Body):
    endpoint: str


class VapidPublicKey(BaseModel):
    public_key: str
