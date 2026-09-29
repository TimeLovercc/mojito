"""Text the hub writes for the user to read (record titles/bodies, push labels), in the
language of settings.language (api.md 界面语言): no field names or raw enum values."""

import json
from datetime import date

from . import db

# key → (zh, en); str.format placeholders
TEXT = {
    "empty": ("空", "none"),
    "titled": ("{head}：{rest}", "{head}: {rest}"),
    "change": ("{field} 从 {old} 改成 {new}", "{field}: {old} → {new}"),
    "changes_sep": ("；", "; "),
    "list_sep": ("、", ", "),
    "parts_sep": ("，", ", "),
    "added": ("加上 {x}", "added {x}"),
    "removed": ("去掉 {x}", "removed {x}"),
    "reordered": ("调整了顺序", "reordered"),
    "on": ("开", "on"),
    "off": ("关", "off"),
    "notify_all_on": ("全部开", "all on"),
    "notify_off": ("关掉 {x}", "off: {x}"),
    "keywords": ("关键词 {x}", "keywords {x}"),
    "field_value": ("{field} {value}", "{field} {value}"),
    "image": ("[图片]", "[Image]"),
    # change / undo records
    "heading_goal": ("目标 {x}", "Goal {x}"),
    "heading_plan": ("计划 {start}–{end}", "Plan {start}–{end}"),
    "heading_project": ("项目 {x}", "Project {x}"),
    "heading_settings": ("设置", "Settings"),
    "heading_subscription": ("订阅 {x}", "Subscription {x}"),
    "heading_note": ("笔记「{x}」", "Note “{x}”"),
    "undone": ("已撤销：{x}", "Undone: {x}"),
    "restored": ("恢复为 {x}", "Restored: {x}"),
    "changed_later": ("之后又改过，不能撤销（{x}）", "Changed again since, can't undo ({x})"),
    "note_to_item": ("由笔记记成事项：{x}", "Note became an item: {x}"),
    "from_note": ("来自笔记「{x}」", "From note “{x}”"),
    "item_create_undone": ("事项已关闭，笔记不再挂在这件事上。", "The item is closed and the note is no longer attached to it."),
    "to_item": ("转成事项：{x}", "Make an item: {x}"),
    # decisions
    "decision_approve": ("同意", "Approved"),
    "decision_decline": ("不要", "Declined"),
    "decision_postpone": ("推迟", "Postponed"),
    "decision_done": ("完成", "Done"),
    "decision_close": ("关闭", "Closed"),
    "decision_reopen": ("重新打开", "Reopened"),
    "project_approve": ("同意项目", "Approved project"),
    "project_decline": ("不要项目", "Declined project"),
    "project_pause": ("暂停项目", "Paused project"),
    "project_resume": ("恢复项目", "Resumed project"),
    "project_done": ("完成项目", "Finished project"),
    "draft_resolved": ("给 {to} 的{channel}草稿：{status}", "{channel} draft to {to}: {status}"),
    # jobs
    "job_failed": ("{job}失败：{error}", "{job} failed: {error}"),
    "job_failed_body": ("{job}没有完成：{error}", "{job} did not finish: {error}"),
    "refreshed": ("更新好了", "Updated"),
    "refreshed_body": ("刷新完成，事项和进展已更新。", "Refresh finished; items and progress are up to date."),
    # alerts
    "auth_lost": ("授权失效：{x}", "Authorization lost: {x}"),
    "auth_lost_body": ("{x}检查失败：{detail}", "{x} check failed: {detail}"),
    "auth_back": ("授权恢复：{x}", "Authorization restored: {x}"),
    "auth_back_body": ("{x}检查已恢复正常。", "{x} check is OK again."),
    "source_lost": ("{name} 失联：超过 {s} 秒没有心跳", "{name} is silent: no heartbeat for over {s} s"),
    "source_lost_body": ("上次心跳 {t}（本地时间），期望间隔 {s} 秒。", "Last heartbeat {t} (local time); expected every {s} s."),
    "review_due": ("该复盘了", "Time for the review"),
    "review_due_body": ("计划 {start} 至 {end} 今天到期。复盘写完、确认后才能开新一期。",
                        "The plan {start} – {end} ends today. Finish and confirm the review before the next period starts."),
    "source_health": ("数据源{state}：{name}", "Data source {name} {state}"),
    "subscription_health": ("订阅{state}：{name}", "Subscription {name} {state}"),
    "health_warn": ("有问题", "has a problem"),
    "health_error": ("出错了", "failed"),
    "health_recovered": ("恢复", "recovered"),
    # feedback
    "feedback_shipped": ("已修复", "Fixed"),
    "feedback_declined": ("没改", "Not changed"),
    "feedback_approve": ("同意修改：{x}", "Approved fix: {x}"),
    "feedback_decline": ("不要改：{x}", "Declined fix: {x}"),
    "feedback_approve_body": ("同意上线这个修改。", "Ship this change."),
    "feedback_decline_body": ("不上线这个修改。", "Don't ship this change."),
    "feedback_message_prefix": ("（关于你的反馈「{x}」）", "(About your feedback “{x}”)"),
}

# name tables: table → (zh names, en names)
NAMES = {
    "item_field": ({"title": "标题", "status": "状态", "next_step": "下一步", "next_at": "时间", "owner": "谁做",
                    "project_id": "项目"},
                   {"title": "Title", "status": "Status", "next_step": "Next step", "next_at": "Time", "owner": "Owner",
                    "project_id": "Project"}),
    "item_status": ({"active": "进行中", "waiting_you": "等你", "scheduled": "已排期", "standing": "长期", "done": "完成",
                     "closed": "关闭"},
                    {"active": "Active", "waiting_you": "Waiting for you", "scheduled": "Scheduled", "standing": "Ongoing",
                     "done": "Done", "closed": "Closed"}),
    "owner": ({"me": "我", "auto": "自动", "auto_then_me": "先自动后我"},
              {"me": "Me", "auto": "Auto", "auto_then_me": "Auto, then me"}),
    "project_status": ({"proposed": "待确认", "active": "进行中", "paused": "暂停", "done": "完成", "declined": "不要"},
                       {"proposed": "Proposed", "active": "Active", "paused": "Paused", "done": "Done",
                        "declined": "Declined"}),
    "goal_status": ({"active": "进行中", "done": "完成", "dropped": "放弃"},
                    {"active": "Active", "done": "Done", "dropped": "Dropped"}),
    "area": ({"research": "研究", "life": "生活"}, {"research": "Work", "life": "Life"}),
    "draft_channel": ({"email": "邮件", "message": "消息"}, {"email": "Email", "message": "Message"}),
    "draft_status": ({"sent_by_me": "我已发出", "dismissed": "不要", "pending": "待处理"},
                     {"sent_by_me": "Sent by me", "dismissed": "Dismissed", "pending": "Pending"}),
    "job": ({"refresh": "刷新", "process_note": "整理笔记", "draft_review": "起草复盘", "weekly_summary": "每周总结",
             "sync_projects": "同步项目", "feed_arxiv": "arXiv 日报", "feed_papers": "每日论文", "feed_weekly": "本周论文",
             "feed_mail": "每日邮件", "calendar_delete": "删除日程", "chat_reply": "回复对话",
             "undo": "撤销", "morning_brief": "早上简报", "evening_prompt": "晚间提问", "draft_plan": "起草计划"},
            {"refresh": "Refresh", "process_note": "Note processing", "draft_review": "Review draft",
             "weekly_summary": "Weekly summary", "sync_projects": "Project sync", "feed_arxiv": "arXiv digest",
             "feed_papers": "Daily papers", "feed_weekly": "Weekly papers", "feed_mail": "Daily mail",
             "calendar_delete": "Calendar delete", "chat_reply": "Chat reply",
             "undo": "Undo", "morning_brief": "Morning brief", "evening_prompt": "Evening question",
             "draft_plan": "Plan draft"}),
    "auth": ({"google-calendar-write": "日历写入", "gmail-read": "Gmail 读取", "claude-server": "Claude（服务器）",
              "claude-mac": "Claude（Mac）"},
             {"google-calendar-write": "Calendar write", "gmail-read": "Gmail read", "claude-server": "Claude (server)",
              "claude-mac": "Claude (Mac)"}),
    "notify": ({"brief": "早晚简报", "chat": "对话", "alert": "告警", "feedback": "反馈", "release": "更新", "jobs": "任务"},
               {"brief": "Briefs", "chat": "Chat", "alert": "Alerts", "feedback": "Feedback", "release": "Updates",
                "jobs": "Jobs"}),
    "category": ({"brief": "简报", "chat": "对话", "alert": "告警", "feedback": "反馈", "release": "更新", "jobs": "任务"},
                 {"brief": "Brief", "chat": "Chat", "alert": "Alert", "feedback": "Feedback", "release": "Update",
                  "jobs": "Job"}),
    "language": ({"zh": "中文", "en": "English"}, {"zh": "中文", "en": "English"}),
    # subscription names are shown by kind, not from the stored name (api.md 补充)
    "subscription": ({"papers": "论文", "mail": "每日邮件"},
                     {"papers": "Papers", "mail": "Daily mail"}),
    "field_goal": ({"title": "标题", "status": "状态"}, {"title": "Title", "status": "Status"}),
    "field_plan": ({"start": "开始", "end": "结束", "goal_ids": "目标", "item_ids": "事项"},
                   {"start": "Start", "end": "End", "goal_ids": "Goals", "item_ids": "Items"}),
    "field_project": ({"title": "名称", "area": "分组", "status": "状态", "repo_path": "仓库", "goal_id": "目标"},
                      {"title": "Name", "area": "Group", "status": "Status", "repo_path": "Repository", "goal_id": "Goal"}),
    "field_settings": ({"morning_at": "早上简报时间", "evening_at": "晚间提问时间", "evening_enabled": "晚间提问",
                        "notify": "通知", "language": "界面语言"},
                       {"morning_at": "Morning brief time", "evening_at": "Evening question time",
                        "evening_enabled": "Evening question", "notify": "Notifications", "language": "Language"}),
    "field_note": ({"item_id": "事项", "project_id": "项目"}, {"item_id": "Item", "project_id": "Project"}),
    "field_subscription": ({"at": "时间", "enabled": "开关", "config": "设置"},
                           {"at": "Time", "enabled": "On/off", "config": "Settings"}),
}


def lang() -> str:
    return db.one("SELECT language FROM settings WHERE id = 1")["language"]


def t(key: str, **kw) -> str:
    zh, en = TEXT[key]
    return (zh if lang() == "zh" else en).format(**kw)


def name(table: str, key: str) -> str:
    zh, en = NAMES[table]
    return (zh if lang() == "zh" else en)[key]


def joined(values: list[str]) -> str:
    return t("list_sep").join(values)


def titled(head: str, rest: str) -> str:
    """"<head>：<rest>" (zh) / "<head>: <rest>" (en)"""
    return t("titled", head=head, rest=rest)


def short_time(stored: str) -> str:
    """Stored UTC string → local short form, e.g. 9/29 12:00."""
    local = db.parse(stored).astimezone(db.DAY_TZ)
    return f"{local.month}/{local.day} {local:%H:%M}"


def short_date(iso: str) -> str:
    d = date.fromisoformat(iso)
    return f"{d.month}/{d.day}"


def title_of(table: str, id_: str) -> str:
    return db.one(f"SELECT title FROM {table} WHERE id = ?", id_)["title"]


# ---- items ----

def item_value(field: str, value: str | None) -> str:
    if value is None:
        return t("empty")
    if field == "next_at":
        return short_time(value)
    if field == "status":
        return name("item_status", value)
    if field == "owner":
        return name("owner", value)
    if field == "project_id":
        return title_of("projects", value)
    return value


def item_change(field: str, old: str | None, new: str | None) -> str:
    """e.g. 时间 从 9/28 10:00 改成 9/30 15:00 / Time: 9/28 10:00 → 9/30 15:00"""
    return t("change", field=name("item_field", field), old=item_value(field, old), new=item_value(field, new))


# ---- goal / plan / project / settings / note / subscription changes (changes.py) ----

def entity_field(entity: str, field: str) -> str:
    return name(f"field_{entity}", field)


def entity_value(entity: str, field: str, value) -> str:
    """API value (lists decoded, booleans as bool) → text for the user."""
    if value is None:
        return t("empty")
    if field in ("start", "end"):
        return short_date(value)
    if field == "status":
        return name({"goal": "goal_status", "project": "project_status"}[entity], value)
    if field == "area":
        return name("area", value)
    if field == "goal_id":
        return title_of("goals", value)
    if field == "item_id":
        return title_of("items", value)
    if field == "project_id":
        return title_of("projects", value)
    if field in ("evening_enabled", "enabled"):
        return t("on") if value else t("off")
    if field == "language":
        return name("language", value)
    if field == "notify":
        off = [name("notify", k) for k, on in value.items() if not on]
        return t("notify_all_on") if not off else t("notify_off", x=joined(off))
    if field == "config":
        if "keywords" in value:
            return t("keywords", x=joined(value["keywords"]) if value["keywords"] else t("empty"))
        return json.dumps(value, ensure_ascii=False)
    return str(value)


def entity_change(entity: str, field: str, old, new) -> str:
    label = entity_field(entity, field)
    if field in ("goal_ids", "item_ids"):
        table = "goals" if field == "goal_ids" else "items"
        added = [title_of(table, i) for i in new if i not in old]
        removed = [title_of(table, i) for i in old if i not in new]
        parts = ([t("added", x=joined(added))] if added else []) + ([t("removed", x=joined(removed))] if removed else [])
        return f"{label} {t('parts_sep').join(parts) if parts else t('reordered')}"
    return t("change", field=label, old=entity_value(entity, field, old), new=entity_value(entity, field, new))
