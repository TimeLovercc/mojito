"""Project panel: sync Orca repos/worktrees into hub project snapshots, propose projects for new
Orca repos, and (on refresh) write a one-line summary per active project.

Orca and git are read-only here. Worktrees are tied to repos by Orca's repoId, repos to projects
by repo_path.
"""
import re
import subprocess
from datetime import UTC, datetime
from pathlib import Path

from mojito_worker import claude, health, orca
from mojito_worker.hub import Hub
from mojito_worker.i18n import say
from mojito_worker.local_facts import LocalFactError
from mojito_worker.prompting import user_text_rules, dump, now_context
from mojito_worker.redact import redact
from mojito_worker.validate import (
    ValidationError,
    require_enum,
    require_fields,
    require_nonempty_str,
)

PROJECT_STATUSES = ("proposed", "active", "paused", "done", "declined")
AREAS = ("research", "life")
SNAPSHOT_DAYS = 7
SNAPSHOT_COMMITS = 20
LAST_OUTPUT_CHARS = 200
PROPOSE_LOG_COMMITS = 10
README_CHARS = 2000
PROJECT_ID = re.compile(r"^[a-z0-9][a-z0-9-]*$")


# ---------------------------------------------------------------- facts

def _commits(repo_path: str, repo_name: str) -> list[dict]:
    proc = subprocess.run(
        ["git", "-C", repo_path, "log", "--all", f"--since={SNAPSHOT_DAYS}.days.ago", "-n", str(SNAPSHOT_COMMITS),
         "--date=iso-strict", "--pretty=format:%h%x1f%ad%x1f%s"],
        capture_output=True, text=True, timeout=30,
    )
    if proc.returncode != 0:
        raise LocalFactError(f"git log in {repo_path}: {proc.stderr.strip()}")
    commits = []
    for line in proc.stdout.splitlines():
        sha, at, subject = line.split("\x1f", 2)
        commits.append({"repo": repo_name, "sha": sha, "subject": subject, "at": at})
    return commits


TAIL_LINES = 40
NOISE = re.compile(
    r"^\s*$"                      # blank
    r"|^\s*✻ .*\b(done|for)\b"   # Claude Code "✻ Cooked for 43s · done 9:43 PM"
    r"|new task\? /clear"
    r"|^\s*\S \S+… \(\d"             # spinner "✶ Garnishing… (2m 29s · ↓ 17.0k tokens)"
    r"|\(ctrl\+b to run in background\)"
    r"|^\s*[❯›]"                  # input prompts
    r"|^\(.*\) \S+@\S+ .*%\s*%?$"  # zsh prompt
    r"|^\s*%\s*$"
)


def _is_rule(line: str) -> bool:
    return sum(c in "─━" for c in line) > len(line) / 2 > 10


def _gist(tail: list[str]) -> str | None:
    """Last meaningful output: drop Claude Code's input box and status bar (everything from the
    second-to-last horizontal rule on), then UI noise; keep the last LAST_OUTPUT_CHARS characters."""
    rules = [i for i, line in enumerate(tail) if _is_rule(line)]
    body = tail[:rules[-2]] if len(rules) >= 2 else tail
    lines = [" ".join(line.split()) for line in body if not NOISE.search(line)]
    text = redact(" ".join(lines))
    if not text:
        return None
    return text if len(text) <= LAST_OUTPUT_CHARS else "…" + text[-(LAST_OUTPUT_CHARS - 1):]


def _last_output(worktree_id: str, terminals: list[dict]) -> str | None:
    """Gist of the most recently active terminal in this worktree, secrets masked."""
    mine = [t for t in terminals if t["worktreeId"] == worktree_id]
    if not mine:
        return None
    latest = max(mine, key=lambda t: t["lastOutputAt"])
    return _gist(orca.terminal_read(latest["handle"], TAIL_LINES))


def _snapshot(repo: dict, worktrees: list[dict], terminals: list[dict]) -> dict:
    return {
        "taken_at": datetime.now(UTC).isoformat(),
        "worktrees": [{
            "name": w["displayName"],
            "branch": w["branch"].removeprefix("refs/heads/"),
            "path": w["path"],
            "status": w["workspaceStatus"],
            "last_output": _last_output(w["id"], terminals),
            "last_activity_at": orca.ms_to_iso(w["lastActivityAt"]),
        } for w in worktrees if w["repoId"] == repo["id"]],
        "commits": _commits(repo["path"], repo["displayName"]),
    }


# ---------------------------------------------------------------- propose new repos

PROPOSE_SCHEMA = {
    "type": "object",
    "properties": {
        "projects": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "repo_path": {"type": "string"},
                    "id": {"type": "string"},
                    "title": {"type": "string"},
                    "area": {"type": "string", "enum": list(AREAS)},
                },
                "required": ["repo_path", "id", "title", "area"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["projects"],
    "additionalProperties": False,
}

PROPOSE_PROMPT = """用户在 Orca 里新加了下面这些仓库，mojito 里还没有对应项目。为每个仓库起草一个项目（用户会确认或拒绝）。
- id：小写字母、数字、连字符，简短，不能和已有项目 id 重复。
- title：简短的项目名（用户会看到）。{rules}
- area：research（科研、论文、实验、代码研究）或 life（生活、个人工具、事务）。
每个仓库恰好一条，repo_path 原样照抄。

已有项目 id：{existing_ids}

新仓库：
{repos}

只输出符合 schema 的 JSON。"""


def _readme(repo_path: str) -> str | None:
    for name in ("README.md", "README", "readme.md"):
        f = Path(repo_path) / name
        if f.is_file():
            return redact(f.read_text(errors="replace"))[:README_CHARS]
    return None


def _recent_subjects(repo_path: str) -> list[str]:
    proc = subprocess.run(["git", "-C", repo_path, "log", "-n", str(PROPOSE_LOG_COMMITS), "--pretty=format:%s"],
                          capture_output=True, text=True, timeout=30)
    # An Orca repo can be a fresh `git init` with no commits yet; that is a fact, not an error.
    return proc.stdout.splitlines() if proc.returncode == 0 else []


def _propose(hub: Hub, new_repos: list[dict], existing_ids: set[str], lang: str) -> list[dict]:
    prompt = PROPOSE_PROMPT.format(
        rules=user_text_rules(lang),
        existing_ids=dump(sorted(existing_ids)),
        repos=dump([{"repo_path": r["path"], "orca_name": r["displayName"],
                     "readme": _readme(r["path"]), "recent_commits": _recent_subjects(r["path"])} for r in new_repos]),
    )
    result = claude.ask_json(prompt, PROPOSE_SCHEMA)
    require_fields(result, ("projects",), "claude propose")
    wanted = {r["path"] for r in new_repos}
    got = [p["repo_path"] for p in result["projects"]]
    if sorted(got) != sorted(wanted):
        raise ValidationError(f"claude propose: repo_paths {got} != {sorted(wanted)}")
    ids = set(existing_ids)
    for i, p in enumerate(result["projects"]):
        where = f"claude propose projects[{i}]"
        require_fields(p, ("repo_path", "id", "title", "area"), where)
        require_nonempty_str(p, "title", where)
        require_enum(p, "area", AREAS, where)
        if not PROJECT_ID.match(p["id"]) or p["id"] in ids:
            raise ValidationError(f"{where}: id={p['id']!r} invalid or already taken")
        ids.add(p["id"])
    for p in result["projects"]:
        hub.put_project(p["id"], {"title": p["title"], "area": p["area"], "status": "proposed",
                                  "repo_path": p["repo_path"], "goal_id": None})
        hub.post_event(kind="log", tier="log", item_id=None, project_id=p["id"],
                       title=say(lang, "发现新仓库，建议作为项目：{title}", title=p["title"]),
                       body=say(lang, "Orca 里新加的仓库 {repo} 还没有对应项目，已起草为待确认项目。",
                                repo=Path(p["repo_path"]).name),
                       evidence=f"orca:repo:{p['repo_path']}")
    return result["projects"]


# ---------------------------------------------------------------- sync

def sync(hub: Hub, lang: str) -> None:
    """Sync and report result health (failure -> error) for the system page."""
    try:
        snapshots, proposed = _sync(hub, lang)
    except Exception as e:
        health.report_error(hub, health.SYNC_PROJECTS, e)
        raise
    health.report(hub, health.SYNC_PROJECTS, "ok", say(lang, "更新了 {n} 个项目快照", n=snapshots)
                  + (say(lang, "，新发现 {n} 个仓库", n=proposed) if proposed else ""))


def _sync(hub: Hub, lang: str) -> tuple[int, int]:
    """(snapshots written, projects proposed)."""
    projects = [p for s in PROJECT_STATUSES for p in hub.list_projects(s)]
    by_repo = {p["repo_path"]: p for p in projects if p["repo_path"] is not None}
    repos = orca.repos()
    worktrees = orca.worktrees()
    terminals = orca.terminals()

    new_repos = [r for r in repos if r["path"] not in by_repo]
    proposed = _propose(hub, new_repos, {p["id"] for p in projects}, lang) if new_repos else []
    for p in proposed:
        by_repo[p["repo_path"]] = {"id": p["id"], "status": "proposed"}

    snapshots = 0
    for repo in repos:
        if repo["path"] not in by_repo or by_repo[repo["path"]]["status"] == "declined":
            continue
        hub.put_snapshot(by_repo[repo["path"]]["id"], _snapshot(repo, worktrees, terminals))
        snapshots += 1
    return snapshots, len(proposed)


def sync_projects(hub: Hub, job: dict, lang: str) -> None:
    sync(hub, lang)


# ---------------------------------------------------------------- summaries (on refresh)

SUMMARY_SCHEMA = {
    "type": "object",
    "properties": {
        "summaries": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "project_id": {"type": "string"},
                    "summary": {"type": "string"},
                    "evidence": {"type": "string"},
                },
                "required": ["project_id", "summary", "evidence"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["summaries"],
    "additionalProperties": False,
}

SUMMARY_PROMPT = """为用户 mojito 里每个进行中的项目写一句话现状（≤60 字或 30 个英文词，说清最近在干什么、卡在哪或下一步）。
{now}

evidence：写出依据——具体 commit sha、记录 id、worktree 名；没有直接依据、是你推断的，就只写 inferred。
不要编造数据里没有的进展。每个项目恰好一条。summary 用户会看到（evidence 不会直接显示，可以写 id）。
{rules}

项目（含事项、Orca 快照、最近记录）：
{projects}

只输出符合 schema 的 JSON。"""


def write_summaries(hub: Hub, lang: str) -> None:
    active = hub.list_projects("active")
    if not active:
        return
    details = [hub.get_project(p["id"]) for p in active]
    result = claude.ask_json(SUMMARY_PROMPT.format(now=now_context(), projects=dump(details), rules=user_text_rules(lang)), SUMMARY_SCHEMA)
    require_fields(result, ("summaries",), "claude summaries")
    got = sorted(s["project_id"] for s in result["summaries"])
    if got != sorted(p["id"] for p in active):
        raise ValidationError(f"claude summaries: project_ids {got} != active {sorted(p['id'] for p in active)}")
    for i, s in enumerate(result["summaries"]):
        where = f"claude summaries[{i}]"
        require_nonempty_str(s, "summary", where)
        require_nonempty_str(s, "evidence", where)
    for s in result["summaries"]:
        hub.put_project_summary(s["project_id"], s["summary"].strip(), s["evidence"].strip())
