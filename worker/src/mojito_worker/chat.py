"""chat_reply for runner=mac: answer a chat message with hub data plus read-only local data.

Claude gets no tools. Up to PLAN_ROUNDS times it returns a structured query plan that this script
executes (git / files / Gmail / Orca, all read-only), then one final call writes the reply
and, when the user wants to reply to or message someone, Drafts that the user sends themselves.
Images attached to the message go to every call as base64 image blocks and are never written to disk.
"""
import re

from mojito_worker import claude, edits, local_facts
from mojito_worker.hub import Hub
from mojito_worker.prompting import user_text_rules, dump, now_context
from mojito_worker.tools import (
    ACTION_SCHEMA,
    LocalTools,
    actions_help,
    evidence,
    validate_action,
)
from mojito_worker.validate import (
    ValidationError,
    require_enum,
    require_fields,
    require_nonempty_str,
)

CHAT_HISTORY_LIMIT = 20
RECENT_CARDS = 10
CARD_FIELDS = ("origin", "kind", "project_id", "title", "summary", "link", "status")
ITEM_BRIEF_FIELDS = ("id", "title", "status", "next_step", "next_at", "owner", "project_id", "goal_id")
# The projects Claude may attach items to; declined/done projects stay listed so their ids are known.
PROJECT_STATUSES = ("proposed", "active", "paused", "done", "declined")
PLAN_ROUNDS = 2
MAX_ACTIONS_PER_ROUND = 6
TITLE_CHARS = 40
DRAFT_CHANNELS = ("email", "message")

PLAN_SCHEMA = {
    "type": "object",
    "properties": {"actions": {"type": "array", "maxItems": MAX_ACTIONS_PER_ROUND, "items": ACTION_SCHEMA}},
    "required": ["actions"],
    "additionalProperties": False,
}

REPLY_SCHEMA = {
    "type": "object",
    "properties": {
        "reply": {"type": "string"},
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
        **edits.SCHEMAS,
    },
    "required": ["reply", "drafts", *edits.OUTPUT_KEYS],
    "additionalProperties": False,
}

CONTEXT = """你是 mojito 的 Mac agent，在用户的 Mac 上运行，替用户回答对话里转过来的消息。
{now}

Mac 上你能拿到的本地数据（全部只读，由脚本替你查）：用户项目目录下 git 仓库的提交和已跟踪文件、
Gmail（只读）、Orca 的 worktree 和终端输出（只读）。
原则：对话 = app 里能点的一切 + 立刻跑任务 + 问系统状态。用户要的一句话能改的都直接改（见下面的输出字段），不要说"对话里没有这个开关"。
只有这些不做：
- 对外发送（邮件、私信、评论、付款都不行）：要回信或给别人发消息时只起草 Draft，由用户自己在原渠道发出。
- 操作 Orca 终端（只能读）。
- 改 mojito 本身的代码或功能：说成"给 mojito 的建议"，告诉用户在系统页"反馈与建议"里提一句就会转给维护会话；不要自己描述怎么改代码。
日历不在 Mac 上写（日历由服务器上的 agent 处理，让用户在对话里直接说要建或删什么日程）。
某类数据查询报错说"还没接上"时，如实告诉用户，不要编，也不要建议用户去授权、安装或配置什么。

本地 git 仓库（名字 = 相对用户项目目录的路径）：
{repos}

最近 {days} 天有提交的仓库：
{commits}

hub 上的今天（/today）：
{today}

全部未结束的事项（改事项时用这里的 id）：
{items}

目标：{goals}
项目：{projects}
可以改的计划（进行中和草稿）：{plans}
设置：{settings}
订阅（信息流的来源，改时间 / 开关用这里的 id）：{subscriptions}

信息流里最近的卡片（新的和收藏的，最多 {cards_n} 张）：
{cards}
{item}
最近对话（倒序）：
{chat}

用户这条消息：
{message}
{images}"""

PLAN_INSTRUCTIONS = """
{results}
现在只决定还需要查哪些本地数据（不要回答用户）。可用动作（每轮最多 {max_actions} 个，用不到的参数填 null）：
{actions}
已有信息足够、或者这条消息不需要本地数据时，返回空 actions。只输出符合 schema 的 JSON。"""

REPLY_INSTRUCTIONS = """
{results}
现在回复用户（语言见下面的规则）。要求：
- 像发短信，简洁直接；第一句就是结论（前 40 字会作为推送标题），出处放后面；需要时列要点。
- 依据来自本地数据或 hub 时点明出处（用项目或仓库名、邮件发件人和日期、Orca worktree 名），推断的内容说明是推断。
- 格式：短段落和列表，重点用 Markdown **粗体**，可以用 Markdown 链接；app 会正确显示。
- drafts：只有用户要回信或给别人发消息时才写（channel=email 时 to 写邮箱、subject 写主题；channel=message 时 to 写对方和平台，subject 为 null）；
  写了草稿就在 reply 里说"草稿放在等你拍板里了，你确认后自己发"。其他情况 drafts 为空数组。
{edits}
{rules}
只输出符合 schema 的 JSON。"""


def plain_text(markdown: str) -> str:
    """The reply without Markdown marks, for the push title: [text](url) -> text, no **, no list bullets."""
    text = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", markdown)
    text = re.sub(r"^\s*(?:[-*]|\d+\.)\s+", "", text.replace("**", ""), flags=re.MULTILINE)
    return re.sub(r"\s+", " ", text).strip()


def _validate_plan(plan: dict) -> list[dict]:
    require_fields(plan, ("actions",), "claude plan")
    if len(plan["actions"]) > MAX_ACTIONS_PER_ROUND:
        raise ValidationError(f"claude plan: {len(plan['actions'])} actions > {MAX_ACTIONS_PER_ROUND}")
    for i, a in enumerate(plan["actions"]):
        validate_action(a, f"claude plan actions[{i}]")
    return plan["actions"]


def _validate_answer(answer: dict) -> None:
    require_fields(answer, ("reply", "drafts"), "claude reply")
    require_nonempty_str(answer, "reply", "claude reply")
    for i, d in enumerate(answer["drafts"]):
        where = f"claude reply drafts[{i}]"
        require_fields(d, ("channel", "to", "subject", "body"), where)
        require_enum(d, "channel", DRAFT_CHANNELS, where)
        require_nonempty_str(d, "to", where)
        require_nonempty_str(d, "body", where)


def chat_reply(hub: Hub, job: dict, lang: str) -> None:
    message = hub.get_record(job["record_id"])
    images = [hub.get_attachment(a["id"]) for a in message["attachments"]]
    repos = local_facts.find_repos()
    tools = LocalTools(repos)
    item_ctx = ""
    if message["item_id"] is not None:
        item_ctx = f"\n消息挂在这个事项上：\n{dump(hub.get_item(message['item_id']))}\n"
    if message["project_id"] is not None:
        item_ctx += f"\n消息属于这个项目（含事项、Orca 快照、最近记录）：\n{dump(hub.get_project(message['project_id']))}\n"
    if message["card_id"] is not None:
        card = hub.get_card(message["card_id"])
        item_ctx += f"\n用户是在信息流的这张卡片上提问（\"问问这个\"）：\n{dump({k: card[k] for k in CARD_FIELDS})}\n"
    today = hub.get_today()
    items = {i["id"]: i for i in hub.list_items()}
    goals = hub.list_goals()
    projects = [p for s in PROJECT_STATUSES for p in hub.list_projects(s)]
    plans = {p["id"]: p for p in hub.list_plans() if p["status"] in edits.EDITABLE_PLAN_STATUSES}
    recent_cards = hub.list_recent_cards(RECENT_CARDS)
    subs = hub.list_subscriptions()
    edit_ctx = edits.EditContext(
        items=items,
        goals={g["id"]: g for g in goals},
        projects={p["id"]: p for p in projects},
        plans=plans,
        active_plan=today["plan"],
        subscriptions={s["id"]: s for s in subs},
        card_ids={c["id"] for c in recent_cards} | ({message["card_id"]} if message["card_id"] is not None else set()),
        new_item_prefix=f"chat-{message['id']}",
    )
    context = CONTEXT.format(
        now=now_context(),
        repos=dump(sorted(repos)),
        days=local_facts.RECENT_COMMITS_DAYS,
        commits=dump(local_facts.recent_commits(repos, local_facts.RECENT_COMMITS_DAYS)),
        today=dump(today),
        items=dump([{k: i[k] for k in ITEM_BRIEF_FIELDS} for i in items.values() if i["status"] not in ("done", "closed")]),
        goals=dump([{k: g[k] for k in ("id", "title", "status")} for g in goals]),
        projects=dump([{k: p[k] for k in ("id", "title", "area", "status", "goal_id")} for p in projects]),
        plans=dump(list(plans.values())),
        settings=dump(hub.get_settings()),
        subscriptions=dump([{k: s[k] for k in ("id", "name", "kind", "at", "enabled", "config", "last_result")} for s in subs]),
        cards_n=RECENT_CARDS,
        cards=dump([{k: c[k] for k in ("id", "at", *CARD_FIELDS)} for c in recent_cards]),
        item=item_ctx,
        chat=dump([{k: r[k] for k in ("at", "author", "source", "body")} for r in hub.list_chat(CHAT_HISTORY_LIMIT, message["item_id"], message["project_id"])]),
        message=dump({"at": message["at"], "body": message["body"]}),
        images=(f"用户随消息附了 {len(images)} 张图片（就是这次输入里的图片），要结合图片内容回答。\n" if images else ""),
    )

    results: list[dict] = []
    for _ in range(PLAN_ROUNDS):
        results_text = f"已查到的本地数据：\n{dump(results)}\n" if results else ""
        prompt = context + PLAN_INSTRUCTIONS.format(results=results_text, max_actions=MAX_ACTIONS_PER_ROUND, actions=actions_help())
        actions = _validate_plan(claude.ask_json_with_images(prompt, images, PLAN_SCHEMA))
        if not actions:
            break
        results.extend(tools.run(a) for a in actions)

    results_text = f"查到的本地数据：\n{dump(results)}\n" if results else ""
    answer = claude.ask_json_with_images(context + REPLY_INSTRUCTIONS.format(results=results_text, edits=edits.INSTRUCTIONS, rules=user_text_rules(lang)), images, REPLY_SCHEMA)
    _validate_answer(answer)
    edits.validate(answer, edit_ctx, hub)
    edits.apply(hub, answer, edit_ctx)

    for i, d in enumerate(answer["drafts"]):
        hub.put_draft(f"d-{message['id']}-{i + 1}", {
            "channel": d["channel"],
            "to": d["to"],
            "subject": d["subject"],
            "body": d["body"],
            "item_id": message["item_id"],
        })
    reply = answer["reply"].strip()
    hub.post_event(
        kind="chat",
        tier="digest",
        item_id=message["item_id"],
        project_id=message["project_id"],
        title=plain_text(reply)[:TITLE_CHARS],
        body=reply,
        evidence=evidence(results),
    )
