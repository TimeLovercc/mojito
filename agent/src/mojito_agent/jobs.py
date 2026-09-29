import json
import logging
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from mojito_agent import claude, edits
from mojito_agent.texts import all_languages, mentions, t
from mojito_agent.config import SOURCE_NAME, TIMEZONE, Config
from mojito_agent.gcal import (
    CalendarUnavailable,
    EventAmbiguous,
    EventNotFound,
    GoogleCalendar,
    brief,
    restorable,
    time_field,
)
from mojito_agent.hub import Hub
from mojito_agent.validate import (
    ValidationError,
    require_aware_datetime_or_null,
    require_enum,
    require_fields,
    require_nonempty_str,
)

log = logging.getLogger("mojito_agent.jobs")
LOCAL_TZ = ZoneInfo(TIMEZONE)
CATEGORIES = ("research", "life")
OWNERS = ("auto", "me", "auto_then_me")
CHAT_HISTORY_LIMIT = 20
CALENDAR_DAYS = 7
MOJITO_EVENTS_DAYS = 14
CALENDAR_LOG_SCAN = 100
CALENDAR_OPS = ("create", "update", "delete")
DRAFT_CHANNELS = ("email", "message")
RECORDS_PAGE = 100
TITLE_CHARS = 40
MAX_ATTACHMENTS = 4  # api.md: at most 4 images per chat message, each ≤1600px (keeps claude -p under MemoryMax)
CARDS_PAGE = 100
CHAT_CARDS = 10
FEED_NEW_WINDOW = timedelta(hours=24)
CALENDAR_AUTH = "google-calendar-write"
EVENING_UNANSWERED_DAYS = 3


def _now() -> datetime:
    return datetime.now(LOCAL_TZ)


def _now_context() -> str:
    now = _now()
    return f"现在是 {now.isoformat(timespec='minutes')}（{now:%A}，用户时区 {TIMEZONE}）。hub 数据里的时间是 UTC，换算成用户时区再说。"


def _dump(obj) -> str:
    return json.dumps(obj, ensure_ascii=False, indent=2)


def _at(record: dict) -> datetime:
    return datetime.fromisoformat(record["at"])


def _title(text: str) -> str:
    return text.strip().splitlines()[0][:TITLE_CHARS]


def _records_since(hub: Hub, cutoff: datetime) -> list[dict]:
    """All records with at >= cutoff, newest first (pages through GET /records)."""
    out: list[dict] = []
    before = None
    while True:
        page = hub.list_records(limit=RECORDS_PAGE, before=before)
        out.extend(r for r in page if _at(r) >= cutoff)
        if len(page) < RECORDS_PAGE or _at(page[-1]) < cutoff:
            return out
        before = page[-1]["id"]


# ---------------------------------------------------------------- chat_reply

DRAFT_FIELDS = ("title", "category", "next_step", "next_at", "owner", "done_definition", "goal_id", "project_id")

CHAT_OUTPUTS = ("reply", "forward_to_mac", "calendar_actions", "drafts", "new_items", "item_updates", "plan_changes",
                "goal_updates", "plan_updates", "project_updates", "settings_update", "card_actions", "note_links",
                "taste_notes", "subscription_updates", "run_jobs", "feedback", "feedback_reply")
# Jobs a chat can start right now (api.md 8.7); all run on the Mac. The hub dedups an already queued/running kind.
RUN_JOB_KINDS = ("refresh", "sync_projects", "draft_review", "feed_papers", "feed_mail")
CHAT_NOTES = 10
MAINTAINER_SOURCE = "maintainer"
MAINTAINER_MESSAGES = 3

CHAT_SCHEMA = {
    "type": "object",
    "properties": {
        "item_updates": edits.ITEM_UPDATES_SCHEMA,
        "plan_changes": edits.PLAN_CHANGES_SCHEMA,
        "reply": {"type": "string"},
        "forward_to_mac": {"type": "boolean"},
        "goal_updates": edits.GOAL_UPDATES_SCHEMA,
        "plan_updates": edits.PLAN_UPDATES_SCHEMA,
        "project_updates": edits.PROJECT_UPDATES_SCHEMA,
        "settings_update": edits.SETTINGS_UPDATE_SCHEMA,
        "card_actions": edits.CARD_ACTIONS_SCHEMA,
        "note_links": edits.NOTE_LINKS_SCHEMA,
        "taste_notes": edits.TASTE_NOTES_SCHEMA,
        "subscription_updates": edits.SUBSCRIPTION_UPDATES_SCHEMA,
        "run_jobs": {"type": "array", "items": {"type": "string", "enum": list(RUN_JOB_KINDS)}},
        "feedback": {"type": "boolean"},
        "feedback_reply": {
            "type": ["object", "null"],
            "properties": {"feedback_id": {"type": "string"}, "body": {"type": "string"}},
            "required": ["feedback_id", "body"],
            "additionalProperties": False,
        },
        "calendar_actions": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "op": {"type": "string", "enum": list(CALENDAR_OPS)},
                    "event_id": {"type": ["string", "null"], "description": "mojito event_id for update/delete; null for create"},
                    "title": {"type": ["string", "null"]},
                    "start": {"type": ["string", "null"], "description": "ISO-8601 datetime with offset, or YYYY-MM-DD for all-day"},
                    "end": {"type": ["string", "null"], "description": "same format as start; all-day end date is exclusive"},
                    "location": {"type": ["string", "null"]},
                },
                "required": ["op", "event_id", "title", "start", "end", "location"],
                "additionalProperties": False,
            },
        },
        "drafts": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "channel": {"type": "string", "enum": list(DRAFT_CHANNELS)},
                    "to": {"type": "string"},
                    "subject": {"type": ["string", "null"]},
                    "body": {"type": "string"},
                },
                "required": ["channel", "to", "subject", "body"],
                "additionalProperties": False,
            },
        },
        "new_items": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "title": {"type": "string"},
                    "category": {"type": "string", "enum": list(CATEGORIES)},
                    "next_step": {"type": "string"},
                    "next_at": {"type": ["string", "null"], "description": "ISO-8601 datetime with timezone offset, or null"},
                    "owner": {"type": "string", "enum": list(OWNERS)},
                    "done_definition": {"type": "string"},
                    "goal_id": {"type": ["string", "null"]},
                    "project_id": {"type": ["string", "null"]},
                },
                "required": list(DRAFT_FIELDS),
                "additionalProperties": False,
            },
        },
    },
    "required": list(CHAT_OUTPUTS),
    "additionalProperties": False,
}

CHAT_PROMPT = """你是 mojito 的服务器轻量 agent，在手机 app 的对话里回复用户（中文，简短，像发短信）。mojito 是用户的个人"看清楚"系统：事项、计划、记录、日历都在 hub 里。

{now}

原则：对话 = app 里能点的一切 + 立刻跑任务 + 问系统状态。用户让你做的，能做就直接做，不要说"对话里没有这个开关"、不要让用户自己去 app 里点。只有三类不做：对外发送（只起草）、操作 Orca 终端、改 mojito 的代码（这类当成给 mojito 的建议，feedback=true 转给维护会话）。

你能做的：
- 根据下面给出的 hub 数据（今天、日历、事项、计划、项目、目标、笔记、信息流、订阅、系统状态、对话记录）回答问题。只根据这些数据说事实；数据里没有的就直说不知道，推断要说明是推断。
- run_jobs：用户要"现在跑 / 刷新 / 同步 / 复盘"时立刻开始对应任务（都在 Mac 上跑，Mac 睡着就等它醒）：刷新事项进展 → refresh；同步 Orca 项目 → sync_projects；现在复盘、起草下一期 → draft_review；论文 → feed_papers；每日邮件 → feed_mail；"信息流都跑一遍" → 论文、邮件两个都给。同一种任务已经在排队或在跑时不会重复跑（系统会合并），不用提醒用户会跑两次。reply 说"已开始，跑完会推送"（信息流类说"跑完进信息流"）。没有就给空数组。

让下一步是"今天能做的一小步"：用户回复晚间提问"今天推进了什么？"、或聊到某件事的进展时，按回复内容、两周计划进度和日历，用 item_updates 把今日重点里相关事项的 next_step 改成今天（或下次）能做的一小步具体动作，必要时改 next_at；推进完了的改 status=done。回复里简短说一句改成了什么。

用户在对话里亲口要求的改动，一律直接做（用户已允许），不要再让用户去"等你拍板"里确认；每个改动 hub 都会在时间线上留一条可撤销的记录，reply 里说清改了什么，并提一句可以在时间线上撤销。下面这些输出没有就给空数组或 null：
- item_updates：改已有事项 {{item_id, changes}}，changes 只放要改的字段（next_step / next_at / status / owner / title / project_id）。做完了 → status=done；删掉 / 不要了 / 取消 → closed（事项不会被真的删除，关闭就是删掉）；重新打开 → active。done_definition 永远不能改。
- goal_updates：改目标 {{goal_id, changes: {{title?, status?}}}}（status: active / done / dropped），changes 只放要改的字段；新建目标时给一个新的 goal_id（小写英文短横线，如 learn-spanish），changes 里 title 和 status 都要给。
- plan_updates：改两周计划 {{plan_id, add_item_ids, remove_item_ids, goal_ids（新的目标列表，不换给 null）, start, end（YYYY-MM-DD，不改给 null）}}，plan_id 必须是"当前两周计划"或"草稿计划"里的。只在用户明确要调整计划时给；关掉或完成某个事项本身不用动计划。
- project_updates：改项目 {{project_id, changes: {{title?, area?, status?, repo_path?, goal_id?}}}}（area: research / life；status: active / paused / done / declined），changes 只放要改的字段；新建项目时给一个新的 project_id（小写英文短横线），changes 里 title、area、goal_id（可 null）都要给。
- settings_update：改设置 {{changes: {{morning_at?, evening_at?（HH:MM 用户时区）, evening_enabled?}}}}，只放要改的字段；不改给 null。用户说不要晚间提问 → evening_enabled=false，要恢复 → true。当前设置：{settings}
- card_actions：信息流卡片 {{card_id, status}}：收藏 → saved，不感兴趣 → dismissed，放回未读 → new。card_id 来自下面的卡片。
- note_links：把用户的笔记挂到事项或项目 {{record_id, item_id, project_id}}（都可 null，null 表示不挂），record_id 来自下面"最近的笔记"。
- subscription_updates：改订阅 {{id, changes: {{at?（HH:MM 用户时区）, enabled?, config?}}}}，id 来自下面"订阅"。论文、每日邮件各一个订阅；改推送时间给 at，开关给 enabled；论文和邮件都没有 config（不给 config）。
- taste_notes：用户说出的读论文 / 信息流偏好（喜欢什么方向、不想看什么、关注哪位作者），每条一句话记进口味档案，用来挑以后的论文。只记用户明确表达的偏好。

只在 Claude 自己想到、用户没要求时才走"等你拍板"（plan_changes）；新建事项直接建（new_items）：
- plan_changes：你觉得计划该调整、但用户没要求时，给 {{add_item_ids, remove_item_ids, goal_ids}} 起草一个修订版进"等你拍板"；用户明确要求时用 plan_updates 直接改，不要用这个。
- new_items：只在用户明确说要记下 / 跟进 / 加一件新事时给，给出完整的事项，直接建成进行中（用户亲口要求的，不进"等你拍板"）；回复里说已经加上了。回复维护会话、提建议、问问题、闲聊时一律不建事项，也不要自己顺手建。

- 需要用户 Mac 上本地登录态或本机数据的请求（查邮件、Orca 里的会话/终端、本机文件、git 仓库），你做不了：forward_to_mac=true，reply 用一两句说明会让 Mac 做什么。Mac 醒来后会接着回复。其余情况 forward_to_mac=false。
- 写 Google Calendar（用户已允许，直接做）：用户要约时间/建日程/改时间/取消时，在 calendar_actions 里给动作。
  - create：title、start、end 必填（location 可 null），event_id 为 null。只把有真实时间的事放进日历；事项的内部检查时间不进日历。
  - update：event_id 必须来自下面"mojito 建的日程"列表；只填要改的字段，其余 null，改时间时 start 和 end 都给。用户自己建的日程不能改，告诉用户自己去改。
  - delete：任何日程都能删。mojito 建的日程用它的 event_id（start 给 null）；其他日程用"日历"里的 uid 作 event_id，并把那一次的 start 原样填进 start（重复日程只删这一次）。
  - 时间用 ISO-8601 带用户时区偏移（和上面"现在"里的偏移一致）；全天事件用 YYYY-MM-DD（end 是结束日的第二天）。
  - reply 里说清做了什么，并提一句可以在时间线上撤销。没有日历动作就给空数组。
- 对外发送（邮件、给别人发消息）只起草：在 drafts 里给出 channel（email / message）、to（收件人，地址或名字）、subject（邮件主题，消息给 null）、body（完整正文）。草稿进"等你拍板"，用户复制后自己在原渠道发出；reply 里这样说。不要把对外发送写成 new_items。
- 给 mojito 本身的建议或问题（app 哪里不好用、想要什么功能、发现了 bug）：feedback=true，会原样转给维护会话（带上这条消息的图片），reply 说"已转给维护会话"。只是在用 mojito 做事（问事项、改计划）不算。
- 用户在回复维护会话的问题时（看下面"维护会话最近的消息"，用户这条消息明显是在回答它）：feedback_reply={{feedback_id, body（用户原话）}}，reply 说"已转给维护会话"。否则 null。

不要编造 app 功能：回复里不许声称 app 有某个按钮或功能，除非你确定它存在。能自己做的就直接做，不要让用户去 app 里手动操作；实在需要用户操作而又不确定 app 怎么做时，只说"你可以在事项详情点完成/关闭"。用户写的东西叫"笔记"，不要说"记一笔"。

你不能做的（直接告诉用户）：
- 真正发出任何东西：发邮件、给别人发消息、付款、下单。只能起草（drafts）。
- 操作 Orca 里的终端和会话。
- 改 mojito 的代码或界面：当成建议，feedback=true 转给维护会话。
- 改 done_definition（完成标准）。

new_items 字段要求：
- title：简短具体的中文标题；category：research（工作、研究、论文、实验）或 life（生活、账单、预约、手续等）。
- next_step：下一步具体动作；next_at：ISO-8601 带用户时区偏移（和上面"现在"里的偏移一致），实在无法安排给 null。
- owner：auto（机器能做完）、me（用户做）、auto_then_me（机器准备、用户收尾）。
- done_definition：什么算做完；最后一步要用户本人做的（付款、签约、提交、发送），写成"你做了 X"。
- goal_id：从目标列表里选最相关的 id，都不相关给 null。
- project_id：从进行中的项目列表里选它属于的项目 id，都不属于给 null（归"其他"）。

目标列表：
{goals}

进行中的项目（summary 是一句话现状，stale=超过 7 天没动静）：
{projects}
{project}
今天（GET /today）。今天页的规则（用户问起时照这个说）：
- 今日重点（focus）= 下一步时间落在用户时区的今天、状态是进行中/等你/已排期的全部事项，再加上今天之后最近的一件（days_until 是还有几天，0 = 今天），不管在不在两周计划里。只要还有带时间的进行中事项，今日重点就不会空。
- 逾期（overdue）= 还在做、下一步时间早于今天 0 点、但 7 天内动过的事项（琥珀）。
- 被忘了（forgotten）= 没有下一步时间，或过期且 7 天以上没动过的事项（红）。
- 等你拍板（needs_you）= Claude 主动提出、等用户同意的东西：笔记整理出的事项草稿、复盘后起草的下一期计划、对外草稿、新发现的 Orca 仓库。
- 夜里（alerts）= 还没读的告警。今天的日程（schedule）来自 Google 日历。
{today}

项目（进行中和暂停的，可用于 project_updates）：
{all_projects}

草稿计划（可用于 plan_updates）：
{draft_plans}

最近的笔记（用户自己写的，record_id 用于 note_links）：
{notes}

口味档案里已有的偏好（不要重复记）：
{taste}

维护会话最近的消息（用户可能在回答它；feedback_id 用于 feedback_reply）：
{maintainer}

系统状态（数据源是否在线、结果健康、授权是否有效、正在排队和运行的任务）：
{system}

订阅（论文 / 每日邮件，每天按 at 推到信息流）：
{subscriptions}

信息流最近的卡片（新的和收藏的，最多 {cards_n} 张）。用户问信息流、论文、推荐读什么时，直接从这里列出（标题 + 一句为什么值得看 + 链接），并建议去"信息流"页签看全部；这里没有就说目前信息流里没有：
{cards}

未完成的事项（可用于 item_updates / plan_changes）：
{open_items}

当前两周计划（item_ids 是计划里的事项；null = 没有 active 计划）：
{plan}

日历（今天起 {days} 天，全部日程，只读）：
{calendar}

{mojito_events}

最近你做过的日历操作（新 → 旧；undone_at 非空表示用户已撤销）：
{calendar_log}
{item}{card}
最近对话（旧 → 新）：
{history}

只处理用户这条消息：最近对话里更早的请求只当背景，已经做过或没做成的都不要在这次重做（没做成的，用户会自己再说）。

用户这条消息（attachments = 附带的图片数；有图时图片就在这段文字之前，按顺序是第 1…n 张，回答要看图）：
{message}

{rules}

只输出符合 schema 的 JSON。"""


def _require_time(obj: dict, field: str, where: str) -> None:
    require_nonempty_str(obj, field, where)
    try:
        time_field(obj[field])
    except ValueError as e:
        raise ValidationError(f"{where}: {field}={obj[field]!r} is neither YYYY-MM-DD nor ISO datetime") from e


def _validate_calendar_action(action: dict, mojito_ids: set[str], calendar_uids: set[str], where: str) -> None:
    require_fields(action, ("op", "event_id", "title", "start", "end", "location"), where)
    require_enum(action, "op", CALENDAR_OPS, where)
    if action["op"] == "create":
        if action["event_id"] is not None:
            raise ValidationError(f"{where}: create must not carry event_id, got {action['event_id']!r}")
        require_nonempty_str(action, "title", where)
        _require_time(action, "start", where)
        _require_time(action, "end", where)
        return
    if action["op"] == "delete":
        if action["event_id"] in mojito_ids:
            return
        if action["event_id"] not in calendar_uids:
            raise ValidationError(f"{where}: event_id={action['event_id']!r} is neither a mojito event nor a calendar uid")
        require_nonempty_str(action, "start", where)
        return
    if action["event_id"] not in mojito_ids:
        raise ValidationError(f"{where}: event_id={action['event_id']!r} is not a mojito event {sorted(mojito_ids)}")
    if action["op"] == "update":
        changes = [f for f in ("title", "start", "end", "location") if action[f] is not None]
        if not changes:
            raise ValidationError(f"{where}: update changes nothing")
        for f in ("start", "end"):
            if action[f] is not None:
                _require_time(action, f, where)


def _validate_chat(result: dict, goal_ids: set[str], project_ids: set[str], mojito_ids: set[str],
                   calendar_uids: set[str]) -> None:
    require_fields(result, CHAT_OUTPUTS, "claude chat")
    require_nonempty_str(result, "reply", "claude chat")
    if not isinstance(result["forward_to_mac"], bool):
        raise ValidationError(f"claude chat: forward_to_mac must be bool, got {result['forward_to_mac']!r}")
    for kind in result["run_jobs"]:
        require_enum({"kind": kind}, "kind", RUN_JOB_KINDS, "claude chat run_jobs")
    if len(set(result["run_jobs"])) != len(result["run_jobs"]):
        raise ValidationError(f"claude chat run_jobs: duplicates in {result['run_jobs']}")
    if not isinstance(result["feedback"], bool):
        raise ValidationError(f"claude chat: feedback must be bool, got {result['feedback']!r}")
    if result["feedback"] and result["feedback_reply"] is not None:
        raise ValidationError("claude chat: feedback and feedback_reply are exclusive")
    for i, action in enumerate(result["calendar_actions"]):
        _validate_calendar_action(action, mojito_ids, calendar_uids, f"claude chat calendar_actions[{i}]")
    for i, draft in enumerate(result["drafts"]):
        where = f"claude chat drafts[{i}]"
        require_fields(draft, ("channel", "to", "subject", "body"), where)
        require_enum(draft, "channel", DRAFT_CHANNELS, where)
        require_nonempty_str(draft, "to", where)
        require_nonempty_str(draft, "body", where)
    for i, draft in enumerate(result["new_items"]):
        where = f"claude chat new_items[{i}]"
        require_fields(draft, DRAFT_FIELDS, where)
        for f in ("title", "next_step", "done_definition"):
            require_nonempty_str(draft, f, where)
        require_enum(draft, "category", CATEGORIES, where)
        require_enum(draft, "owner", OWNERS, where)
        require_aware_datetime_or_null(draft, "next_at", where)
        if draft["goal_id"] is not None and draft["goal_id"] not in goal_ids:
            raise ValidationError(f"{where}: goal_id={draft['goal_id']!r} not in {sorted(goal_ids)}")
        if draft["project_id"] is not None and draft["project_id"] not in project_ids:
            raise ValidationError(f"{where}: project_id={draft['project_id']!r} not an active project {sorted(project_ids)}")


def _rules(language: str) -> str:
    """Appended to every prompt whose output the user reads: the output language and the user-text rules."""
    return f"{t(language, 'language_rule')}\n{t(language, 'rules')}"


def _when(event: dict, language: str) -> str:
    """Short LOCAL_TZ-time label of a gcal.brief() event, e.g. 9/30 14:00 or 9/30 全天 / 9/30 all day."""
    start = event["start"]
    if len(start) == 10:
        d = date.fromisoformat(start)
        return f"{d.month}/{d.day} {t(language, 'all_day')}"
    at = datetime.fromisoformat(start).astimezone(LOCAL_TZ)
    return f"{at.month}/{at.day} {at:%H:%M}"


def _describe(event: dict, language: str) -> str:
    """User-facing: 标题（9/29 15:00–16:00 @ 地点） / Title (9/29 15:00–16:00 @ place); LOCAL_TZ time, no ids."""
    location = f" @ {event['location']}" if event["location"] is not None else ""
    if len(event["start"]) == 10:
        span = _when(event, language)
    else:
        start = datetime.fromisoformat(event["start"]).astimezone(LOCAL_TZ)
        end = datetime.fromisoformat(event["end"]).astimezone(LOCAL_TZ)
        end_text = f"{end:%H:%M}" if end.date() == start.date() else f"{end.month}/{end.day} {end:%H:%M}"
        span = f"{_when(event, language)}–{end_text}"
    return t(language, "event_desc", title=event["title"], span=span, location=location)


def _short_time(iso: str) -> str:
    at = datetime.fromisoformat(iso).astimezone(LOCAL_TZ)
    return f"{at.month}/{at.day} {at:%H:%M}"


def _run_calendar_action(hub: Hub, cal: GoogleCalendar, action: dict, item_id: str | None, project_id: str | None,
                         record_id: str, language: str) -> None:
    op = action["op"]
    if op == "create":
        event = cal.create({
            "summary": action["title"],
            "start": time_field(action["start"]),
            "end": time_field(action["end"]),
            "location": action["location"],
            "description": None,
        }, footer=t(language, "description_footer"))
        after = brief(event)
        title = t(language, "cal_created_title", title=after["title"], when=_when(after, language))
        body = t(language, "cal_created_body", event=_describe(after, language))
        undo = {"type": "calendar", "op": "create", "event_id": event["id"], "before": None}
        evidence = event["htmlLink"]
    elif op == "update":
        original = cal.get_mojito(action["event_id"])
        fields = {}
        if action["title"] is not None:
            fields["summary"] = action["title"]
        if action["start"] is not None:
            fields["start"] = time_field(action["start"])
        if action["end"] is not None:
            fields["end"] = time_field(action["end"])
        if action["location"] is not None:
            fields["location"] = action["location"]
        event = cal.patch(action["event_id"], fields)
        before, after = brief(original), brief(event)
        title = t(language, "cal_updated_title", title=after["title"], when=_when(after, language))
        body = t(language, "cal_updated_body", before=_describe(before, language), after=_describe(after, language))
        undo = {"type": "calendar", "op": "update", "event_id": event["id"], "before": restorable(original)}
        evidence = event["htmlLink"]
    else:
        if action["start"] is None:
            original = cal.get_mojito(action["event_id"])
        else:
            original = _find_calendar_event(cal, action["event_id"], action["start"], language)
        cal.delete(original["id"])
        before = brief(original)
        title = t(language, "cal_deleted_title", title=before["title"], when=_when(before, language))
        body = t(language, "cal_deleted_body", event=_describe(before, language))
        undo = {"type": "calendar", "op": "delete", "event_id": original["id"], "before": restorable(original)}
        evidence = f"record:{record_id}"
    hub.post_event(kind="log", tier="digest", item_id=item_id, project_id=project_id, title=title,
                   body=f"{body}\n{t(language, 'undo_hint')}", evidence=evidence, undo=undo, category=None)


def _open_calendar(hub: Hub, config: Config) -> GoogleCalendar:
    """Credentials are loaded per use (the file is runtime state). Reports auth status; re-raises when unavailable."""
    try:
        cal = GoogleCalendar(config.google_oauth)
    except CalendarUnavailable as e:
        hub.put_auth_status(CALENDAR_AUTH, ok=False, detail=e.detail)
        raise
    hub.put_auth_status(CALENDAR_AUTH, ok=True, detail=None)  # hub dedups; lets the status recover without waiting an hour
    return cal


def _card_brief(card: dict, project_titles: dict[str, str]) -> dict:
    """Compact card for the chat context: title, kind, project, first sentence of the summary, link."""
    project = card["project_id"]
    return {
        "card_id": card["id"],
        "title": card["title"],
        "kind": card["kind"],
        "status": card["status"],
        "project": project_titles[project] if project in project_titles else project,
        "summary": card["summary"].split("。")[0][:200],
        "link": card["link"],
    }


def chat_reply(hub: Hub, config: Config, job: dict) -> None:
    record_id = job["record_id"]
    message = hub.get_record(record_id)
    item_id = message["item_id"]
    project_id = message["project_id"]
    # Narrowest thread: the item's chat, else the project's chat, else all chat.
    history = hub.list_chat(limit=CHAT_HISTORY_LIMIT, item_id=item_id, project_id=None if item_id else project_id)
    item = ""
    if item_id is not None:
        item = f"\n这段对话挂在这个事项上（事项 + 它的记录）：\n{_dump(hub.get_item(item_id))}\n"
    project = ""
    if project_id is not None:
        project = f"\n这条消息属于这个项目（项目、事项、Orca 快照、最近记录）：\n{_dump(hub.get_project(project_id))}\n"
    card = ""
    if message["card_id"] is not None:
        card = f"\n用户在问信息流里的这张卡片：\n{_dump(hub.get_card(message['card_id']))}\n"
    projects = hub.list_projects(status="active")
    all_projects = {p["id"]: p for p in hub.list_projects(status=None)}
    project_titles = {p["id"]: p["title"] for p in all_projects.values()}
    items_by_id = {i["id"]: i for i in hub.list_items()}
    plan = hub.current_plan()
    today_data = hub.today()
    editable_plans = {p["id"]: p for p in today_data["needs_you"]["plans"]}
    if plan is not None:
        editable_plans[plan["plan"]["id"]] = plan["plan"]
    notes = hub.list_notes(limit=CHAT_NOTES)
    subscriptions = {sub["id"]: sub for sub in hub.list_subscriptions()}
    recent_cards = hub.list_cards(limit=CHAT_CARDS, before=None, status=None)
    card_ids = {c["id"] for c in recent_cards}
    if message["card_id"] is not None:
        card_ids.add(message["card_id"])
    maintainer = [r for r in hub.list_chat(limit=CHAT_HISTORY_LIMIT, item_id=None, project_id=None)
                  if r["source"] == MAINTAINER_SOURCE][:MAINTAINER_MESSAGES]
    now = _now()
    today = now.date()
    calendar_events = hub.calendar(today, today + timedelta(days=CALENDAR_DAYS))
    goals = hub.list_goals()
    settings = hub.get_settings()
    language = settings["language"]
    try:
        cal = _open_calendar(hub, config)
    except CalendarUnavailable:
        cal = None
    if cal is None:
        mojito_events = []
        mojito_section = ("日历写入授权失效：这次不能建、改、删日程。calendar_actions 必须给空数组；"
                          "用户要动日历时，在 reply 里说明\"日历授权失效，没建成\"。")
    else:
        mojito_events = [brief(e) for e in cal.list_mojito(now, now + timedelta(days=MOJITO_EVENTS_DAYS))]
        mojito_section = f"mojito 建的日程（未来 {MOJITO_EVENTS_DAYS} 天，可 update / delete，用 event_id）：\n{_dump(mojito_events)}"
    prompt = CHAT_PROMPT.format(
        now=_now_context(),
        settings=_dump(settings),
        goals=_dump([{"id": g["id"], "title": g["title"], "status": g["status"]} for g in goals]),
        projects=_dump([{k: p[k] for k in ("id", "title", "area", "summary", "stale", "open_items")} for p in projects]),
        project=project,
        today=_dump(today_data),
        all_projects=_dump([{k: p[k] for k in ("id", "title", "area", "status", "repo_path", "goal_id")} for p in all_projects.values()]),
        draft_plans=_dump([{k: p[k] for k in ("id", "start", "end", "goal_ids", "item_ids", "revises")}
                           for p in today_data["needs_you"]["plans"]]),
        notes=_dump([{"record_id": n["id"], "at": n["at"], "title": n["title"], "body": n["body"][:200],
                      "item_id": n["item_id"], "project_id": n["project_id"]} for n in notes]),
        taste=_dump([t["text"] for t in hub.list_taste()]),
        maintainer=_dump([{"feedback_id": r["feedback_id"], "at": r["at"], "body": r["body"]} for r in maintainer]),
        system=_dump({
            "sources": [{k: src[k] for k in ("name", "alive", "last_seen_at", "health", "health_detail")} for src in hub.list_sources()],
            "auth": [{k: a[k] for k in ("name", "ok", "detail", "checked_at")} for a in hub.auth_status()],
            "jobs": [{k: j[k] for k in ("kind", "runner", "status", "requested_at")}
                     for status in ("queued", "running") for j in hub.list_jobs(status=status)],
        }),
        subscriptions=_dump([{k: sub[k] for k in ("id", "name", "kind", "at", "enabled", "config", "last_result", "health")}
                             for sub in subscriptions.values()]),
        cards_n=CHAT_CARDS,
        cards=_dump([_card_brief(c, project_titles) for c in recent_cards]),
        open_items=_dump([{k: i[k] for k in ("id", "title", "status", "next_step", "next_at", "owner", "project_id")}
                          for i in items_by_id.values() if i["status"] in edits.OPEN_STATUSES]),
        plan=_dump(None if plan is None else {k: plan["plan"][k] for k in ("id", "start", "end", "goal_ids", "item_ids")}),
        days=CALENDAR_DAYS,
        calendar=_dump(calendar_events),
        mojito_events=mojito_section,
        calendar_log=_dump([{"at": r["at"], "title": r["title"], "undone_at": r["undone_at"]}
                            for r in hub.list_records(limit=CALENDAR_LOG_SCAN, before=None) if r["undo"] is not None]),
        item=item,
        card=card,
        rules=_rules(language),
        history=_dump([{"at": r["at"], "author": r["author"], "source": r["source"], "body": r["body"],
                        "attachments": len(r["attachments"])}
                       for r in reversed(history) if r["id"] != record_id]),
        message=_dump({"at": message["at"], "body": message["body"], "attachments": len(message["attachments"])}),
    )
    # Only the current message's images go to Claude; older ones stay as counts in the history.
    if len(message["attachments"]) > MAX_ATTACHMENTS:
        raise ValidationError(f"message {record_id}: {len(message['attachments'])} attachments > {MAX_ATTACHMENTS}")
    images = [hub.get_attachment(a["id"]) for a in message["attachments"]]
    result = claude.ask_json(config.claude_bin, prompt, CHAT_SCHEMA, images)
    reply = result["reply"]
    log.info("chat %s actions: %s", record_id,
             json.dumps({k: v for k, v in result.items() if k != "reply" and v}, ensure_ascii=False))
    if cal is None:
        # Calendar is down: never execute (or validate) calendar actions; make sure the reply says so.
        if result["calendar_actions"] and not mentions(language, "calendar_down_marker", reply):
            reply = f"{reply}\n{t(language, 'calendar_down_note')}"
        result["calendar_actions"] = []
    _validate_chat(result, {g["id"] for g in goals}, {p["id"] for p in projects}, {e["event_id"] for e in mojito_events},
                   {e["uid"] for e in calendar_events})
    edits.validate_item_updates(result["item_updates"], items_by_id, {p["id"] for p in projects})
    edits.validate_plan_changes(result["plan_changes"], plan, set(items_by_id), {g["id"] for g in goals})
    goals_by_id = {g["id"]: g for g in goals}
    edits.validate_goal_updates(result["goal_updates"], goals_by_id)
    edits.validate_plan_updates(result["plan_updates"], editable_plans, set(items_by_id), set(goals_by_id))
    edits.validate_project_updates(result["project_updates"], all_projects, set(goals_by_id))
    edits.validate_settings_update(result["settings_update"])
    edits.validate_card_actions(result["card_actions"], card_ids)
    edits.validate_note_links(result["note_links"], {n["id"] for n in notes}, set(items_by_id), set(all_projects))
    edits.validate_taste_notes(result["taste_notes"])
    edits.validate_subscription_updates(result["subscription_updates"], subscriptions)
    maintainer_feedback_ids = {r["feedback_id"] for r in maintainer}
    if result["feedback_reply"] is not None and result["feedback_reply"]["feedback_id"] not in maintainer_feedback_ids:
        raise ValidationError(f"claude chat feedback_reply: feedback_id={result['feedback_reply']['feedback_id']!r} "
                              f"not among recent maintainer messages {sorted(maintainer_feedback_ids)}")

    # Direct edits (the hub records each with an undo), then the "等你拍板" proposals.
    edits.apply_item_updates(hub, result["item_updates"], items_by_id)
    edits.apply_goal_updates(hub, result["goal_updates"], goals_by_id)
    edits.apply_plan_updates(hub, result["plan_updates"], editable_plans)
    edits.apply_project_updates(hub, result["project_updates"], all_projects)
    edits.apply_settings_update(hub, result["settings_update"])
    edits.apply_card_actions(hub, result["card_actions"])
    edits.apply_note_links(hub, result["note_links"])
    edits.apply_taste_notes(hub, result["taste_notes"])
    edits.apply_subscription_updates(hub, result["subscription_updates"], subscriptions)
    if result["plan_changes"] is not None:
        edits.draft_plan_revision(hub, result["plan_changes"], plan)

    for action in result["calendar_actions"]:
        _run_calendar_action(hub, cal, action, item_id, project_id, record_id, language)
    if result["calendar_actions"]:
        hub.refresh_calendar()

    for n, draft in enumerate(result["drafts"], start=1):
        hub.put_draft(f"chat-{record_id}-d{n}", channel=draft["channel"], to=draft["to"], subject=draft["subject"],
                      body=draft["body"], item_id=item_id)

    # Items the user asked for in chat are created active directly (api.md 第 5 节补充); the hub writes no record on
    # creation, so the agent notes where it came from.
    for n, draft in enumerate(result["new_items"], start=1):
        new_id = f"chat-{record_id}-{n}"
        hub.put_item(new_id, {**draft, "status": "active", "progress": None})
        hub.post_event(
            kind="log",
            tier="log",
            item_id=new_id,
            project_id=draft["project_id"],
            title=t(language, "item_created_title", title=draft["title"]),
            body=t(language, "item_created_body", at=_short_time(message["at"]), message=message["title"]),
            evidence=f"record:{record_id}",
            undo=None,
            category=None,
        )

    for kind in result["run_jobs"]:
        hub.create_job(kind=kind, runner="mac", record_id=None)
    if result["run_jobs"] and not mentions(language, "run_jobs_marker", reply):
        reply = f"{reply}\n{t(language, 'run_jobs_note')}"

    attachment_ids = [a["id"] for a in message["attachments"]]
    if result["feedback"]:
        hub.post_feedback(body=message["body"], attachment_ids=attachment_ids,
                          context={"screen": "chat", "item_id": item_id, "project_id": project_id, "app_update_id": None})
    if result["feedback_reply"] is not None:
        hub.post_feedback_message(result["feedback_reply"]["feedback_id"], body=result["feedback_reply"]["body"],
                                  attachment_ids=attachment_ids)
    if (result["feedback"] or result["feedback_reply"] is not None) and not mentions(language, "feedback_marker", reply):
        reply = f"{reply}\n{t(language, 'feedback_note')}"

    if result["forward_to_mac"]:
        hub.post_event(kind="chat", tier="log", item_id=item_id, project_id=project_id, title=t(language, "forwarded_title"), body=reply,
                       evidence="inferred", undo=None, category=None)
        hub.create_job(kind="chat_reply", runner="mac", record_id=record_id)
        return
    hub.post_event(kind="chat", tier="digest", item_id=item_id, project_id=project_id, title=_title(reply), body=reply,
                   evidence="inferred", undo=None, category=None)


# ---------------------------------------------------------------- morning_brief

BRIEF_SCHEMA = {
    "type": "object",
    "properties": {"title": {"type": "string"}, "body": {"type": "string"}},
    "required": ["title", "body"],
    "additionalProperties": False,
}

BRIEF_PROMPT = """你是 mojito 的服务器轻量 agent，给用户写今天的早上简报，作为一条普通通知 + 对话消息。

{now}

要求：
- 内容就是答案，不寒暄。中文，手机上一屏读完。
- body 按顺序：
  1. 今天日程（时间 + 标题，用户时区的时间）。
  2. 今日重点，按项目归类：就是 focus 里的事项，一件不漏、不从别处补。每条写下一步和时间；days_until > 0 的写"还有 N 天"。每个有 summary 或有今日重点的项目一小段——项目名：summary 一句（没有 summary 就省略这句）。事项按 project_id 归到项目，不属于任何项目的放"其他"。stale 的项目可以提一句"一周没动静"。
  3. 逾期（overdue，还在做只是过了时间）和被忘了（forgotten，没有下一步时间或长期没动静）分开说：各提数量和最要紧的一件，没有就不提。
  4. 夜里的要事（未读告警，没有就不提）。
  5. 等你拍板的数量（事项、计划、草稿、新项目），没有就不提。
  6. 信息流新增的卡片数，一句话，如"信息流新增 3 张"（为 0 就不提）。
  某一块没有内容就整块省略。
- title：一行概括今天最重要的一件事，不超过 20 字。
- 只根据下面的数据写，不编造。

今天（GET /today；schedule=今天日程，focus=今日重点（days_until=还有几天），overdue=逾期，forgotten=被忘了，alerts=未读告警，needs_you=等你拍板）：
{today}

进行中的项目：
{projects}

信息流过去 24 小时新增的卡片数：{feed_new}

{rules}

只输出符合 schema 的 JSON。"""


def morning_brief(hub: Hub, config: Config, job: dict) -> None:
    language = hub.get_settings()["language"]
    today = hub.today()
    projects = [{k: p[k] for k in ("id", "title", "area", "summary", "stale", "open_items")}
                for p in hub.list_projects(status="active")]
    since = _now() - FEED_NEW_WINDOW
    feed_new = sum(1 for c in hub.list_cards(limit=CARDS_PAGE, before=None, status="new") if _at(c) >= since)
    needs_you = today["needs_you"]
    if not (today["schedule"] or today["focus"] or today["overdue"] or today["forgotten"] or today["alerts"]
            or any(needs_you.values())
            or any(p["summary"] for p in projects) or feed_new):
        return
    prompt = BRIEF_PROMPT.format(now=_now_context(), today=_dump(today), projects=_dump(projects), feed_new=feed_new,
                                 rules=_rules(language))
    result = claude.ask_json(config.claude_bin, prompt, BRIEF_SCHEMA, [])
    require_fields(result, ("title", "body"), "claude brief")
    require_nonempty_str(result, "title", "claude brief")
    require_nonempty_str(result, "body", "claude brief")
    hub.post_event(kind="chat", tier="digest", item_id=None, project_id=None, title=result["title"], body=result["body"],
                   evidence="inferred", undo=None, category="brief")


# ---------------------------------------------------------------- evening_prompt (rules only, no Claude)

def _start_of_day(day: date) -> datetime:
    return datetime(day.year, day.month, day.day, tzinfo=LOCAL_TZ)


def evening_prompt(hub: Hub, config: Config, job: dict) -> None:
    """Ask the evening question ("今天推进了什么？") unless: evening prompts are turned off in settings, the user already wrote something today, it was already asked today,
    or we already asked whether to continue and got no answer. After 3 unanswered prompts in a row,
    ask once whether to continue instead."""
    settings = hub.get_settings()
    if not settings["evening_enabled"]:
        return
    language = settings["language"]
    # Earlier questions are recognised in either language, so switching the UI language keeps the 3-day rule.
    asked_titles, ask_titles = all_languages("evening_title"), all_languages("evening_ask_title")
    today_start = _start_of_day(_now().date())
    ours = [r for r in hub.list_chat(limit=CHAT_HISTORY_LIMIT, item_id=None, project_id=None)
            if r["source"] == SOURCE_NAME and r["title"] in asked_titles | ask_titles]
    prompts = [r for r in ours if r["title"] in asked_titles][:EVENING_UNANSWERED_DAYS]

    cutoff = today_start
    if ours:
        cutoff = min(cutoff, _at(ours[0]))
    if len(prompts) == EVENING_UNANSWERED_DAYS:
        cutoff = min(cutoff, _at(prompts[-1]))
    mine = [r for r in _records_since(hub, cutoff) if r["author"] == "me"]

    def answered_since(at: datetime) -> bool:
        return any(_at(r) > at for r in mine)

    if any(_at(r) >= today_start for r in mine):
        return
    if ours and _at(ours[0]) >= today_start:
        return
    if ours and ours[0]["title"] in ask_titles and not answered_since(_at(ours[0])):
        return
    if len(prompts) == EVENING_UNANSWERED_DAYS and not answered_since(_at(prompts[-1])):
        hub.post_event(kind="chat", tier="digest", item_id=None, project_id=None, title=t(language, "evening_ask_title"),
                       body=t(language, "evening_ask_body"), evidence=None, undo=None, category="brief")
        return
    hub.post_event(kind="chat", tier="digest", item_id=None, project_id=None, title=t(language, "evening_title"),
                   body=t(language, "evening_body"), evidence=None, undo=None, category="brief")


# ---------------------------------------------------------------- undo (calendar)

class CalendarJobFailed(Exception):
    """A calendar job (undo, calendar_delete) that could not reach Google Calendar; the message is shown to the user."""


def undo(hub: Hub, config: Config, job: dict) -> None:
    """Reverse the calendar action recorded on job.record_id; only mojito-marked events are touched."""
    language = hub.get_settings()["language"]
    record = hub.get_record(job["record_id"])
    u = record["undo"]
    if u["type"] != "calendar":
        raise ValidationError(f"record {record['id']}: unsupported undo type {u['type']!r}")
    try:
        cal = _open_calendar(hub, config)
    except CalendarUnavailable as e:
        raise CalendarJobFailed(t(language, "undo_failed", error=_unavailable(e, language), title=record["title"])) from e
    if u["op"] == "create":
        event = brief(cal.get_mojito(u["event_id"]))
        cal.delete(u["event_id"])
        body = t(language, "undo_create_body", event=_describe(event, language))
    elif u["op"] == "update":
        current = brief(cal.get_mojito(u["event_id"]))
        restored = brief(cal.patch(u["event_id"], u["before"]))
        body = t(language, "undo_update_body", current=_describe(current, language), restored=_describe(restored, language))
    elif u["op"] == "delete":
        restored = brief(cal.restore(u["before"]))
        body = t(language, "undo_delete_body", event=_describe(restored, language))
    else:
        raise ValidationError(f"record {record['id']}: unknown calendar undo op {u['op']!r}")
    hub.post_event(kind="log", tier="log", item_id=record["item_id"], project_id=record["project_id"],
                   title=t(language, "undone_title", title=record["title"]), body=body,
                   evidence=f"record:{record['id']}", undo=None, category=None)
    hub.refresh_calendar()


# ---------------------------------------------------------------- calendar_delete (app: delete any event)

CALENDAR_FIND_PAST = timedelta(days=1)
CALENDAR_FIND_AHEAD = timedelta(days=15)


def _unavailable(e: CalendarUnavailable, language: str) -> str:
    reason = t(language, "reason_missing") if e.detail == "missing" else t(language, "reason_denied")
    return t(language, "calendar_unavailable", reason=reason)


def _find_calendar_event(cal: GoogleCalendar, uid: str, start: str, language: str) -> dict:
    """The occurrence to delete; not found / ambiguous fails the job with a message the user can read."""
    now = _now()
    try:
        return cal.find_instance(uid, start, now - CALENDAR_FIND_PAST, now + CALENDAR_FIND_AHEAD)
    except EventNotFound as e:
        raise CalendarJobFailed(t(language, "event_not_found")) from e
    except EventAmbiguous as e:
        raise CalendarJobFailed(t(language, "event_ambiguous", count=e.count)) from e


def calendar_delete(hub: Hub, config: Config, job: dict) -> None:
    """Delete one Google Calendar event (any event, design 8.5) and record it with an undo that recreates it."""
    language = hub.get_settings()["language"]
    payload = job["payload"]
    try:
        cal = _open_calendar(hub, config)
    except CalendarUnavailable as e:
        raise CalendarJobFailed(t(language, "delete_failed", error=_unavailable(e, language))) from e
    # payload {uid, start}: start pins the one occurrence (recurring events share the uid).
    original = _find_calendar_event(cal, payload["uid"], payload["start"], language)
    cal.delete(original["id"])
    before = brief(original)
    hub.post_event(kind="log", tier="log", item_id=None, project_id=None,
                   title=t(language, "deleted_event_title", event=_describe(before, language)),
                   body=t(language, "deleted_event_body"), evidence=None,
                   undo={"type": "calendar", "op": "delete", "event_id": original["id"], "before": restorable(original)},
                   category=None)
    hub.refresh_calendar()


HANDLERS = {
    "calendar_delete": calendar_delete,
    "chat_reply": chat_reply,
    "morning_brief": morning_brief,
    "evening_prompt": evening_prompt,
    "undo": undo,
}
