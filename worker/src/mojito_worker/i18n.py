"""User-facing language (design 8.9, api.md 界面语言): zh or en, from settings.language.

Text the script writes itself is looked up with the Chinese template as the key; a missing English
translation raises KeyError (no silent fallback). Text Claude writes follows `prompting.user_text_rules`.
"""
from mojito_worker.hub import Hub

LANGUAGES = ("zh", "en")

EN = {
    # process_note / refresh
    "已记成事项：{title}": "Saved as a task: {title}",
    "关于你 {at} 记的「{title}」：{question}\n在对话里回我就行。":
        "About your note \"{title}\" from {at}: {question}\nJust reply in chat.",
    "刷新：{title} 的下一步改了": "Refresh: next step for {title} changed",
    "依据：{reason}": "Why: {reason}",
    # papers
    "（近几天没有新论文）": "(no new papers in the last few days)",
    "为什么你会感兴趣：{why}": "Why you may care: {why}",
    "相关项目：{project}": "Related project: {project}",
    "发了 {n} 张卡片": "Posted {n} cards",
    "抓到 0 篇新论文（arXiv、HF 每日论文、关注作者都没有没推过的）":
        "0 new papers (nothing unposted from arXiv, HF daily papers or followed authors)",
    "抓到 {n} 篇，按标题粗筛后 0 篇": "Fetched {n}, 0 left after the title screen",
    "抓到 {n} 篇，粗筛 {m} 篇，读摘要后 0 篇": "Fetched {n}, shortlisted {m}, 0 left after reading abstracts",
    "精选的论文都已经推过": "All picked papers were already posted",
    "本周论文（{start}–{end}）": "Papers this week ({start}–{end})",
    "趋势：{trends}": "Trends: {trends}",
    # mail
    "（无主题）": "(no subject)",
    "{sender} · {subject} —— {gist}（{why}）[打开]({link})": "{sender} · {subject} — {gist} ({why}) [Open]({link})",
    "今日邮件：{n} 封值得看": "Today's mail: {n} worth reading",
    "今天没有要紧邮件": "No important mail today",
    "过去 24 小时收到 {n} 封，没有需要你看的。": "{n} emails in the last 24 hours, none that need you.",
    "今天的邮件卡已经发过（收到 {n} 封）": "Today's mail card was already posted ({n} emails)",
    "收到 {n} 封，{m} 封值得看": "{n} emails, {m} worth reading",
    "、": ", ",
    # projects
    "发现新仓库，建议作为项目：{title}": "New repo found, suggested as a project: {title}",
    "Orca 里新加的仓库 {repo} 还没有对应项目，已起草为待确认项目。":
        "The repo {repo} newly added in Orca has no project yet; drafted one for you to confirm.",
    "更新了 {n} 个项目快照": "Updated {n} project snapshots",
    "，新发现 {n} 个仓库": ", found {n} new repos",
    # review
    "{summary}\n\n这两周用了哪些、没用哪些：{usage}": "{summary}\n\nWhat got used these two weeks and what didn't: {usage}",
    "{pattern}（依据：{evidence}）": "{pattern} (evidence: {evidence})",
    "本期（{start}–{end}）复盘草稿已写好；下一期计划草稿之前已经起草过，没有重复起草。":
        "Review draft for {start}–{end} is ready; the next plan was already drafted, so no new draft.",
    "本期（{start}–{end}）复盘草稿已写好：完成 {done} 件，未完成 {missed} 件。"
    "下一期（{next_start}–{next_end}）计划草稿：继续 {cont} 件、新开 {new} 件。去计划页写一句复盘、确认后再批准下一期。":
        "Review draft for {start}–{end} is ready: {done} done, {missed} not done. "
        "Next plan ({next_start}–{next_end}) draft: {cont} continued, {new} new. "
        "Add a line of reflection on the Plan page, then approve the next plan.",
    "复盘草稿好了": "Review draft ready",
    # weekly / watchdog
    "本周总结": "This week",
    "维护会话失联，已开新会话接班": "Maintainer session lost; a new one took over",
    "维护会话超过 30 分钟没有心跳（上次 {at}），": "The maintainer session sent no heartbeat for over 30 minutes (last {at}); ",
    "维护会话一直没有心跳，": "The maintainer session has never sent a heartbeat; ",
    "已在 mojito 主 worktree 开了新的维护会话接班，它会先读交接文档再继续。":
        "opened a new maintainer session in the main mojito worktree; it reads the handover doc first.",
}


def language(hub: Hub) -> str:
    lang = hub.get_settings()["language"]
    if lang not in LANGUAGES:
        raise ValueError(f"settings.language={lang!r} not in {LANGUAGES}")
    return lang


def say(lang: str, zh: str, **values) -> str:
    """The Chinese template `zh`, or its English translation, filled with `values`."""
    return (zh if lang == "zh" else EN[zh]).format(**values)


def join(lang: str, parts: list[str]) -> str:
    return say(lang, "、").join(parts)
