"""Every user-facing string the agent's scripts write (not Claude's), in both UI languages (settings.language,
api.md 界面语言). Keys must match across languages; a missing translation fails at import, never falls back."""

LANGUAGES = ("zh", "en")

TEXTS = {
    "zh": {
        "language_rule": "所有写给用户看的文字（reply、title、body、事项标题、下一步、完成标准、草稿、口味笔记）一律用中文。",
        "rules": """写给用户看的文字规则：
- 时间一律写用户时区的短格式，如 9/28 00:50、10/2 周五 10:00；不要写 ISO 时间、不要写 UTC。
- 不要写任何内部 id（事项、计划、项目、目标、记录、卡片、日程的 id 都不写），用标题或名字指代。
- 不要写字段名（status、next_at、owner、done_definition 等）和英文枚举值，用中文说法：
  事项状态 active=进行中、waiting_you=等你、scheduled=已排期、standing=长期、done=完成、closed=关闭；
  谁做 me=我、auto=自动、auto_then_me=先自动后我；计划 draft=草稿、active=进行中、closed=已结束；
  下一步、时间、谁做、完成标准、项目、目标这样说。完成标准写成"你做了 X"。
- 不要写文件路径、代码、函数名、命令、接口路径，也不要讲 mojito 内部怎么实现；用户问起就说做了什么、结果是什么。
- 可以用 Markdown：短段落和列表，重点用 **粗体**，链接写成 [标题](网址)（app 会正确显示）。不要用标题（#）、表格、代码块。
- "等你拍板""今天""今日重点""逾期""被忘了""计划""项目""信息流""笔记""对话"是 app 里的名字，可以直接用；不要说"需要你"（已改名"等你拍板"），不要说"记一笔"（叫"笔记"）。""",
        "all_day": "全天",
        "event_desc": "{title}（{span}{location}）",
        "description_footer": "由 Mojito 创建",
        "forwarded_title": "已转给 Mac，醒来后回你",
        "evening_title": "今天推进了什么？",
        "evening_body": "回复这条就是今天的笔记，一两句就行。",
        "evening_ask_title": "晚间提问还要继续吗？",
        "evening_ask_body": "最近 3 天的晚间提问都没有回复。回一句要不要继续；在你回复之前我先不问了。",
        "calendar_down_note": "（日历授权失效，日程没建成/没改成，等授权修好后再跟我说一次。）",
        "calendar_down_marker": "日历授权失效",
        "read_only_note": "（这是你订阅的日历（比如工作或学校的 Outlook）里的日程，mojito 改不了，请在原日历里改。）",
        "read_only_marker": "订阅的日历",
        "project_note": "（这个项目的卡片由它自己的会话维护，请在那个会话里改。）",
        "project_marker": "自己的会话",
        "feedback_note": "已转给维护会话。",
        "feedback_marker": "维护会话",
        "run_jobs_note": "已开始，跑完会推送给你。",
        "run_jobs_marker": "开始",
        "undo_hint": "可在时间线上撤销。",
        "cal_created_title": "已建日程：{title} {when}",
        "cal_created_body": "新建 {event}。",
        "cal_updated_title": "已改日程：{title} {when}",
        "cal_updated_body": "原来 {before}\n现在 {after}",
        "cal_deleted_title": "已删日程：{title} {when}",
        "cal_deleted_body": "删除 {event}。",
        "item_created_title": "对话里新建了事项：{title}",
        "item_created_body": "来自 {at} 的对话「{message}」。",
        "undone_title": "已撤销：{title}",
        "undo_create_body": "删除了当时新建的 {event}。",
        "undo_update_body": "从 {current}\n改回 {restored}",
        "undo_delete_body": "重新建了被删的 {event}。",
        "deleted_event_title": "删除了日程：{event}",
        "deleted_event_body": "可在时间线上撤销（会按原样重建，参会人的回复不会恢复）。",
        "reason_missing": "授权文件不在",
        "reason_denied": "Google 拒绝了授权",
        "calendar_unavailable": "日历授权失效（{reason}）",
        "undo_failed": "{error}，没能撤销「{title}」，授权修好后再点一次撤销",
        "delete_failed": "{error}，日程没删成，授权修好后再删一次",
        "event_not_found": "日历里找不到这个日程（可能已经删掉或改过时间），没有删",
        "event_ambiguous": "同一时间有 {count} 个同名日程，分不清删哪个；没有删",
    },
    "en": {
        "language_rule": "Write every user-facing text (reply, title, body, item titles, next steps, done definitions, drafts, taste notes) in English.",
        "rules": """Rules for text the user reads:
- Times in the user's timezone, short form, e.g. 9/28 00:50, Fri 10/2 10:00; no ISO timestamps, no UTC.
- Never write internal ids (of items, plans, projects, goals, records, cards, events); refer to things by title or name.
- Never write field names (status, next_at, owner, done_definition, …) or raw enum values; use the app's words:
  item status active=In progress, waiting_you=Waiting on you, scheduled=Scheduled, standing=Ongoing, done=Done, closed=Closed;
  owner me=Me, auto=Auto, auto_then_me=Auto, then me; plan draft=Draft, active=In progress, closed=Ended;
  say next step, time, owner, done when, project, goal. Phrase a done definition as "You did X".
- No file paths, code, function names, commands or API paths, and don't explain how mojito works inside; say what was done and what came of it.
- Markdown is fine: short paragraphs and lists, key points in **bold**, links as [title](url) (the app renders them). No headings (#), tables or code blocks.
- App names you can use as they are: Your call, Today, Focus, Overdue, Gone quiet, Plan, Projects, Feed, Notes, Chat.""",
        "all_day": "all day",
        "event_desc": "{title} ({span}{location})",
        "description_footer": "Created by Mojito",
        "forwarded_title": "Handed to the Mac; it will reply when it wakes",
        "evening_title": "What did you move forward today?",
        "evening_body": "Your reply becomes today's note. A sentence or two is enough.",
        "evening_ask_title": "Keep the evening question?",
        "evening_ask_body": "The last 3 evening questions got no reply. Tell me whether to keep asking; until then I'll stop.",
        "calendar_down_note": "(Calendar access is broken, so the event was not created/changed. Ask me again once access is fixed.)",
        "calendar_down_marker": "Calendar access",
        "read_only_note": "(That event is on a calendar you subscribe to (e.g. a work or school Outlook calendar); mojito can't change it. Please edit it in the original calendar.)",
        "read_only_marker": "subscribe",
        "project_note": "(This project's card is kept by its own session; please change it in that session.)",
        "project_marker": "own session",
        "feedback_note": "Passed to the maintainer.",
        "feedback_marker": "maintainer",
        "run_jobs_note": "Started; you'll get a notification when it's done.",
        "run_jobs_marker": "started",
        "undo_hint": "You can undo this in the timeline.",
        "cal_created_title": "Event added: {title} {when}",
        "cal_created_body": "Added {event}.",
        "cal_updated_title": "Event changed: {title} {when}",
        "cal_updated_body": "Was {before}\nNow {after}",
        "cal_deleted_title": "Event deleted: {title} {when}",
        "cal_deleted_body": "Deleted {event}.",
        "item_created_title": "New item from chat: {title}",
        "item_created_body": "From the {at} chat message \"{message}\".",
        "undone_title": "Undone: {title}",
        "undo_create_body": "Deleted {event}, which had been added.",
        "undo_update_body": "From {current}\nback to {restored}",
        "undo_delete_body": "Re-created the deleted {event}.",
        "deleted_event_title": "Event deleted: {event}",
        "deleted_event_body": "You can undo this in the timeline (it is re-created as it was; attendee replies are not restored).",
        "reason_missing": "credentials file missing",
        "reason_denied": "Google refused access",
        "calendar_unavailable": "Calendar access is broken ({reason})",
        "undo_failed": "{error}; could not undo \"{title}\". Tap undo again once access is fixed",
        "delete_failed": "{error}; the event was not deleted. Delete it again once access is fixed",
        "event_not_found": "Couldn't find this event in the calendar (maybe already deleted or moved); nothing deleted",
        "event_ambiguous": "{count} events with this name at the same time; not sure which one, nothing deleted",
    },
}

if set(TEXTS["zh"]) != set(TEXTS["en"]):
    raise KeyError(f"texts.py: keys differ between zh and en: {sorted(set(TEXTS['zh']) ^ set(TEXTS['en']))}")


def t(language: str, key: str, **values) -> str:
    return TEXTS[language][key].format(**values)


def mentions(language: str, key: str, text: str) -> bool:
    """Does `text` already contain the marker phrase (case-insensitive)?"""
    return TEXTS[language][key].lower() in text.lower()


def all_languages(key: str) -> set[str]:
    """One fixed string in every language (to recognise e.g. earlier evening questions after a language switch)."""
    return {TEXTS[lang][key] for lang in LANGUAGES}
