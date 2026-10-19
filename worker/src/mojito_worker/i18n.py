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
    "抓到 0 篇新论文（arXiv、HF 每日论文、关注作者都没有没推过的）":
        "0 new papers (nothing unposted from arXiv, HF daily papers or followed authors)",
    "抓到 {n} 篇，按标题粗筛后 0 篇": "Fetched {n}, 0 left after the title screen",
    "抓到 {n} 篇，粗筛 {m} 篇，读摘要后 0 篇": "Fetched {n}, shortlisted {m}, 0 left after reading abstracts",
    "本周论文（{start}–{end}）": "Papers this week ({start}–{end})",
    "趋势：{trends}": "Trends: {trends}",
    # brief / watch
    "今日 AI 简报 · {date}": "Daily AI brief · {date}",
    "新模型发布": "New models",
    "重要论文": "Papers",
    "开源项目": "Open source",
    "行业新闻": "Industry news",
    "趋势解读": "Trends",
    "实验室覆盖": "Labs",
    "今天没有": "Nothing today",
    "简报选了 {n} 篇论文": "{n} papers picked for the brief",
    "{source}：{title}": "{source}: {title}",
    "- [{title}]({link})：{what} 和你有关：{why}": "- [{title}]({link}): {what} For you: {why}",
    "【传闻】": "[Rumor] ",
    "【确认】": "[Confirmed] ",
    "这些来源今天没取到：{sources}": "Sources that failed today: {sources}",
    "论文": "papers",
    "新闻": "news",
    "简报写好：论文 {papers} 篇、新闻 {news} 条": "Brief written: {papers} papers, {news} news items",
    "；没取到：{sources}": "; failed: {sources}",
    "今天的简报已经发过": "Today's brief was already posted",
    "相关链接": "Links",
    "新动态 {n} 条：{titles}": "{n} lab updates: {titles}",
    "没有新动态": "No new lab news",
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
    "，{n} 个项目概况来自项目的 overview.json": ", {n} project overviews from the projects' overview.json",
    "项目概况文件有问题：{problems}（{detail}）": "Problem in project overview files: {problems} ({detail})",
    # overview.json check (overview.py)
    "缺少键 {key}": "missing key {key}",
    "{key} 必须是对象或 null，现在是 {value}": "{key} must be an object or null, got {value}",
    "kill.state 只能是 {allowed}，现在是 {value}": "kill.state must be one of {allowed}, got {value}",
    "{key} 必须是列表，现在是 {value}": "{key} must be a list, got {value}",
    "{key} 必须是字符串，现在是 {value}": "{key} must be a string, got {value}",
    "{key} 必须是带时区的 ISO-8601 时间，现在是 {value}": "{key} must be an ISO-8601 time with a time zone, got {value}",
    "card.run_state 只能是 {allowed}，现在是 {value}": "card.run_state must be one of {allowed}, got {value}",
    "card.stage 只能是 {allowed}，现在是 {value}": "card.stage must be one of {allowed}, got {value}",
    "card.decisions 必须是字符串列表，现在是 {value}": "card.decisions must be a list of strings, got {value}",
    "card.history 必须新的在前（按 at 从新到旧排）": "card.history must be newest first (sorted by at, newest to oldest)",
    "研究地图文件有问题：{problems}": "The research map file has problems: {problems}",
    "paper.pending 必须是整数或 null，现在是 {value}": "paper.pending must be an integer or null, got {value}",
    "{key} 必须是字符串或 null，现在是 {value}": "{key} must be a string or null, got {value}",
    "{key} 必须是绝对路径或 null（不许空串），现在是 {value}":
        "{key} must be an absolute path or null (not an empty string), got {value}",
    "score 必须是 0–5 的数字或 null，现在是 {value}": "score must be a number from 0 to 5 or null, got {value}",
    "objections 必须是字符串列表或 null，现在是 {value}": "objections must be a list of strings or null, got {value}",
    "updated_at 必须是带时区的 ISO-8601 时间，现在是 {value}":
        "updated_at must be an ISO-8601 time with a timezone, got {value}",
    "不是合法的 JSON：{error}": "not valid JSON: {error}",
    "顶层必须是 JSON 对象，现在是 {value}": "the top level must be a JSON object, got {value}",
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
    "Mac 上的 Claude 登录过期，请 /login": "Claude on the Mac is logged out; please /login",
    "新会话没有开：在 Mac 任一终端运行 claude，按提示 /login；登录好后看门狗会自动开新会话。":
        "no new session was opened: run claude in any terminal on the Mac and /login as prompted; "
        "once logged in, the watchdog opens the new session by itself.",
    "已在 mojito 主 worktree 开了新的维护会话接班，它会先读交接文档再继续。":
        "opened a new maintainer session in the main mojito worktree; it reads the handover doc first.",
    "已请 Orca 在 mojito 主 worktree 开新的维护会话接班；Orca 回复超时，新会话可能几分钟后才出现。":
        "asked Orca to open a new maintainer session in the main mojito worktree; Orca's reply timed out, "
        "so the new session may take a few minutes to appear.",
    # Idea Lab research runs (research_runner.py)
    "研究结果已保留，但想法在运行中被修改；需合并后再写回。":
        "The research result is saved, but the idea was edited during the run; merge them before writing it back.",
    "研究候选结果已暂存；后续证据复核与文档同步尚未完成。":
        "Candidate result saved; the evidence review and the document sync are not done yet.",
    "本轮候选判断：{status}": "This round's candidate judgment: {status}",
    "本轮新主张尚未确认；保留已有判断，当前状态：{status}":
        "This round's new claim is not confirmed; the earlier judgment stays. Current status: {status}",
    "处理独立复核中的证据缺项：{findings}": "Close the evidence gaps the independent review found: {findings}",
    "独立证据复核：{summary}": "Independent evidence review: {summary}",
    "本轮turn预算不足以进行独立复核，该环节尚未完成。":
        "This round's turn budget left no room for the independent review; that step is not done.",
    "独立复核尚未执行：本轮turn预算不足。": "Independent review not run: the turn budget ran out.",
    "需运行独立证据复核。": "Run the independent evidence review.",
    "研究文本已暂存，尚未同步到研究文档（例如 Notion）。":
        "The research text is saved locally and not yet synced to your research documents (e.g. Notion).",
    "研究执行失败；已保存的暂存结果可检查后重新发起。":
        "The research run failed; check the saved partial results, then start a new run.",
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
