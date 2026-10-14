"""Project panel: sync Orca repos/worktrees into hub project snapshots, propose projects for new
Orca repos, copy each project's own overview.json and the research map file, and (on refresh) write a one-line summary per
active project and a Claude overview for the active projects without an overview.json.

Orca and git are read-only here. Worktrees are tied to repos by Orca's repoId, repos to projects
by repo_path (api.md 项目概况).
"""
import json
import logging
import os
import re
import subprocess
from datetime import UTC, datetime, timedelta
from pathlib import Path

from mojito_worker import card_watch, claude, health, orca, overview
from mojito_worker.hub import Hub
from mojito_worker.i18n import say
from mojito_worker.local_facts import LocalFactError
from mojito_worker.overview import (
    FILE_CONTENT_FIELDS,
    KILL_SCHEMA,
    OVERVIEW_FIELDS,
    OVERVIEW_FILE,
    PAPER_PATHS,
    PAPER_SCHEMA,
    REVIEW_SCHEMA_PROPERTIES,
    check_overview_content,
)
from mojito_worker.prompting import user_text_rules, dump, now_context
from mojito_worker.redact import redact
from mojito_worker.validate import (
    ValidationError,
    require_enum,
    require_fields,
    require_nonempty_str,
)

log = logging.getLogger("mojito_worker.projects")

PROJECT_STATUSES = ("proposed", "active", "paused", "done", "declined")
AREAS = ("research", "life")
SNAPSHOT_DAYS = 7
SNAPSHOT_COMMITS = 20
LAST_OUTPUT_CHARS = 200
PROPOSE_LOG_COMMITS = 10
README_CHARS = 2000
PROJECT_ID = re.compile(r"^[a-z0-9][a-z0-9-]*$")


# ---------------------------------------------------------------- overview.json (api.md 项目概况 补充 17:00)

STATUS_FILE = "STATUS.md"
STATUS_CHANGED_AFTER = timedelta(minutes=10)  # STATUS.md edited this long after updated_at = changed since


def _project_dirs(repo_path: str | None, worktrees: list[dict]) -> list[str]:
    """Where a project's session works: its repo and every Orca worktree of it (from a snapshot)."""
    return list(dict.fromkeys(([] if repo_path is None else [repo_path]) + [w["path"] for w in worktrees]))


def _overview_files(dirs: list[str]) -> list[Path]:
    return [Path(d) / OVERVIEW_FILE for d in dirs if (Path(d) / OVERVIEW_FILE).is_file()]


def _read_overview_file(project_id: str, path: Path, lang: str) -> dict:
    """One overview.json without its ignored keys (logged); any problem is a ValidationError naming the file."""
    data, problems, ignored = overview.check_file(path, lang)
    if ignored:
        log.info("%s: %s: ignored unknown keys %s", project_id, path, ignored)
    if problems:
        raise ValidationError(f"{path}: " + "; ".join(problems))
    return data


def _updated_at(path: Path) -> datetime:
    """A file's updated_at, only to pick the newest copy; any problem is a ValidationError naming the file."""
    try:
        data = json.loads(path.read_text())
        at = datetime.fromisoformat(data["updated_at"])
    except (json.JSONDecodeError, KeyError, TypeError, ValueError) as e:
        raise ValidationError(f"{path}: no readable updated_at ({type(e).__name__}: {e})") from e
    if at.tzinfo is None:
        raise ValidationError(f"{path}: updated_at has no time zone")
    return at


def _project_overview(project_id: str, files: list[Path], lang: str) -> dict:
    """The newest (by updated_at) of a project's overview.json files as a source=project overview. Only that
    copy is checked in full (api.md 研究地图): stale copies in old worktrees keep older formats."""
    path = max(files, key=_updated_at)
    data = _read_overview_file(project_id, path, lang)
    updated_at = datetime.fromisoformat(data["updated_at"])
    status = path.parent / STATUS_FILE
    status_file = status if status.is_file() else None
    return {
        "source": "project",
        # api.md 研究地图: kill and the review fields left the file; the hub still has them (older apps) as null
        **dict.fromkeys(OVERVIEW_FIELDS),
        **{f: data[f] for f in FILE_CONTENT_FIELDS},
        "card": data["card"],
        "checked_at": updated_at.isoformat(),
        "status_file": None if status_file is None else str(status_file),
        "status_changed": status_file is not None
                          and datetime.fromtimestamp(status_file.stat().st_mtime, UTC) > updated_at + STATUS_CHANGED_AFTER,
        "evidence": str(path),
    }


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
    mine = [t for t in terminals
            if t["worktreeId"] == worktree_id and t["lastOutputAt"] is not None]
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
                    "area": {"type": "string", "enum": list(AREAS)},
                },
                "required": ["repo_path", "id", "area"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["projects"],
    "additionalProperties": False,
}

PROPOSE_PROMPT = """用户在 Orca 里新加了下面这些仓库，mojito 里还没有对应项目。为每个仓库起草一个项目（用户会确认或拒绝）。
- id：小写字母、数字、连字符，简短，不能和已有项目 id 重复。
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
        require_fields(p, ("repo_path", "id", "area"), where)
        require_enum(p, "area", AREAS, where)
        if not PROJECT_ID.match(p["id"]) or p["id"] in ids:
            raise ValidationError(f"{where}: id={p['id']!r} invalid or already taken")
        ids.add(p["id"])
    for p in result["projects"]:
        title = Path(p["repo_path"]).name  # api.md 项目名: the repo directory name, not a Claude-made one
        hub.put_project(p["id"], {"title": title, "area": p["area"], "status": "proposed",
                                  "repo_path": p["repo_path"], "goal_id": None})
        hub.post_event(kind="log", tier="log", item_id=None, project_id=p["id"],
                       title=say(lang, "发现新仓库，建议作为项目：{title}", title=title),
                       body=say(lang, "Orca 里新加的仓库 {repo} 还没有对应项目，已起草为待确认项目。",
                                repo=Path(p["repo_path"]).name),
                       evidence=f"orca:repo:{p['repo_path']}")
    return result["projects"]


# ---------------------------------------------------------------- sync

def sync(hub: Hub, lang: str) -> None:
    """Sync and report result health for the system page: a failure, or a project whose overview.json
    is malformed (the other projects are still synced), is an error."""
    try:
        snapshots, proposed, overviews, bad_files = _sync(hub, lang)
    except Exception as e:
        health.report_error(hub, health.SYNC_PROJECTS, e)
        raise
    detail = (say(lang, "更新了 {n} 个项目快照", n=snapshots)
              + (say(lang, "，新发现 {n} 个仓库", n=proposed) if proposed else "")
              + (say(lang, "，{n} 个项目概况来自项目的 overview.json", n=overviews) if overviews else ""))
    if bad_files:
        health.report(hub, health.SYNC_PROJECTS, "error",
                      say(lang, "项目概况文件有问题：{problems}（{detail}）", problems="; ".join(bad_files), detail=detail))
        return
    health.report(hub, health.SYNC_PROJECTS, "ok", detail)


def _sync(hub: Hub, lang: str) -> tuple[int, int, int, list[str]]:
    """(snapshots written, projects proposed, overviews copied from overview.json, "<project>: <problem>"
    for each project whose overview.json is malformed)."""
    projects = [p for s in PROJECT_STATUSES for p in hub.list_projects(s)]
    by_repo = {p["repo_path"]: p for p in projects if p["repo_path"] is not None}
    repos = orca.repos()
    worktrees = orca.worktrees()
    terminals = orca.terminals()

    new_repos = [r for r in repos if r["path"] not in by_repo]
    proposed = _propose(hub, new_repos, {p["id"] for p in projects}, lang) if new_repos else []
    for p in proposed:
        by_repo[p["repo_path"]] = {"id": p["id"], "status": "proposed"}

    snapshot_worktrees = {}
    for repo in repos:
        if repo["path"] not in by_repo or by_repo[repo["path"]]["status"] == "declined":
            continue
        snapshot = _snapshot(repo, worktrees, terminals)
        hub.put_snapshot(by_repo[repo["path"]]["id"], snapshot)
        snapshot_worktrees[by_repo[repo["path"]]["id"]] = snapshot["worktrees"]

    # The project's own overview.json is the truth: overwrite every time, a source=me edit included.
    overviews, bad_files = 0, []
    targets = [(p["id"], p["repo_path"]) for p in projects] + [(p["id"], p["repo_path"]) for p in proposed]
    dirs = {project_id: _project_dirs(repo_path, snapshot_worktrees[project_id] if project_id in snapshot_worktrees else [])
            for project_id, repo_path in targets}
    card_watch.WATCH.rebuild([d for ds in dirs.values() for d in ds])  # before reading: later edits are caught
    for project_id, _ in targets:
        files = _overview_files(dirs[project_id])
        if not files:
            continue
        try:
            project_overview = _project_overview(project_id, files, lang)
        except ValidationError as e:  # only this project fails; reported in sync-projects health
            bad_files.append(f"{project_id}: {e}")
            continue
        hub.put_project_overview(project_id, project_overview)
        overviews += 1
    map_problems = _research_map_problems(_research_map_file(), projects, lang)
    if map_problems:
        bad_files.append(say(lang, "研究地图文件有问题：{problems}", problems="；".join(map_problems)))
    else:
        hub.put_research_map(json.loads(_research_map_file().read_text()))
    return len(snapshot_worktrees), len(proposed), overviews, bad_files


# ---------------------------------------------------------------- research map (api.md 研究地图)

def _research_map_file() -> Path:
    """worker/.env MOJITO_RESEARCH_MAP (required): read at sync time, so a missing setting fails the sync."""
    return Path(os.environ["MOJITO_RESEARCH_MAP"])


MAPPED_STATUSES = ("active", "paused", "done")  # proposed and declined projects need no place yet


def _research_map_problems(path: Path, projects: list[dict], lang: str) -> list[str]:
    """What the hub cannot check: ids that must match each other and the hub's projects. The shape is the
    hub's ResearchMap (a bad shape is a 422 on PUT)."""
    data = json.loads(path.read_text())
    leaves = [l["id"] for a in data["areas"] for l in a["children"]]
    origins = [o for a in data["areas"] for l in a["children"] for o in l["origins"]]
    principles = [x["id"] for x in data["principles"]]
    ids = principles + [a["id"] for a in data["areas"]] + leaves + [o["id"] for o in origins]
    places = set(leaves) | {o["id"] for o in origins} | {a["id"] for a in data["areas"] if not a["children"]}
    known = {p["id"] for p in projects}
    placed = [p["id"] for p in data["projects"]]
    problems = [f"{path}: id {i!r} is used twice" for i in sorted({i for i in ids if ids.count(i) > 1})]
    problems += [f"{path}: origin {o['id']!r} cites unknown principle {r!r}" for o in origins for r in o["principles"] if r not in principles]
    problems += [f"{path}: area {p['area']!r} of {p['id']} is not an origin, a leaf or a leafless area" for p in data["projects"] if p["area"] not in places]
    problems += [f"{path}: project {i} is not in the hub" for i in placed + data["hidden"] if i not in known]
    problems += [f"{path}: project {i} is listed twice" for i in sorted({i for i in placed + data["hidden"] if (placed + data["hidden"]).count(i) > 1})]
    problems += [f"{path}: hub project {p['id']} ({p['title']}) is neither placed nor hidden"
                 for p in projects if p["status"] in MAPPED_STATUSES and p["id"] not in placed and p["id"] not in data["hidden"]]
    problems += [f"{path}: inbox idea {i} suggests unknown area {x['area']!r}" for i, x in enumerate(data["inbox"])
                 if x["area"] is not None and x["area"] not in places]
    return problems


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


# ---------------------------------------------------------------- overviews (on refresh)

STATUS_DOCS = ("BRIEF.md", "STATUS.md")
FALLBACK_DOCS = ("README.md", "HANDOFF.md", "SOURCE_OF_TRUTH.md")  # read when the repo has neither status doc
DOC_CHARS = 6000

OVERVIEW_SCHEMA = {
    "type": "object",
    "properties": {
        "overviews": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "project_id": {"type": "string"},
                    "one_liner": {"type": ["string", "null"]},
                    "status": {"type": ["string", "null"]},
                    "kill": KILL_SCHEMA,
                    "paper": PAPER_SCHEMA,
                    **REVIEW_SCHEMA_PROPERTIES,
                    "evidence": {"type": "string"},
                },
                "required": ["project_id", *OVERVIEW_FIELDS, "evidence"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["overviews"],
    "additionalProperties": False,
}

OVERVIEW_PROMPT = """为用户 mojito 里下面每个进行中的项目写项目概况。用户在项目页看到：一句话、状态、生死实验、论文，
再加一张评审卡片（摘要、查新、意义与下一步、审稿质疑、分数、决定）。
{now}

- one_liner：一句话说清这个项目要回答的问题或要做成的东西（≤60 字或 30 个英文词）。
- status：现在到哪一步、卡在哪、下一步（1–3 句）。
- kill：生死实验 = 决定项目继续还是放弃的那个实验；setting 写实验设置和成立标准，progress 写进展。材料里没有就写 null。
  state 按实际情况选：running（在跑）/ queued（排队中）/ not_started（还没开始，项目也没停）/ passed（判定通过）/
  failed（判定没过）/ paused（暂停：暂时停下、打算回来继续，比如项目暂停中、没在跑）/
  stopped（已停：停项不再继续，但没有判定没过，如行政停项、方向或资源原因、结果没有结论）/
  done（跑完了但没有通过 / 没过之分，少用）。项目暂停时写 paused，不要写 not_started；停项但没判定没过写 stopped，不要写 done 或 failed。
- paper：论文。title、format（如 长文 / 短文）、review（评审分数）、advice（评审建议）、note（备注）不知道就 null；
  pending 是稿子里还没补的 \\pending 处数（整数），不知道就 null；pdf_path / review_path / dir_path 只能照抄材料里出现过的
  Mac 绝对路径（PDF、评审文件、论文目录），否则 null。材料里看不出有论文就整个写 null。
- 评审卡片（材料里没有对应内容就写 null，不要自己评审或打分）：
  abstract：摘要（几句话：问题、做法、预期发现）；novelty：查新（和已有工作比新在哪，可保留材料里的 Markdown 链接，如 arXiv）；
  significance：意义与下一步；objections：审稿质疑，每条一项，写明"能回答"还是"只能部分回答"及怎么答；
  score：材料里明确给出的 0–5 分（如 3.0）；decision：材料里写明的决定（如 继续 / 收窄 / 放弃）。
- evidence：依据——文件路径、commit sha、记录 id；主要是推断的就只写 inferred（evidence 不直接显示）。
不要编造材料里没有的进展、实验或论文。每个项目恰好一条。
{rules}

材料（每个项目：项目、事项、Orca 快照含最近提交、最近记录；docs = 仓库根目录的 BRIEF.md 和 STATUS.md，都没有时是 README / 交接文档）：
{projects}

只输出符合 schema 的 JSON。"""


def _status_docs(repo_path: str | None) -> dict[str, str]:
    """BRIEF.md and STATUS.md, else the README / handoff docs at the repo root: absolute path -> text (secrets masked)."""
    if repo_path is None:
        return {}
    root = Path(repo_path)
    names = STATUS_DOCS if any((root / n).is_file() for n in STATUS_DOCS) else FALLBACK_DOCS
    return {str(root / n): redact((root / n).read_text(errors="replace"))[:DOC_CHARS]
            for n in names if (root / n).is_file()}


def _validate_overview(o: dict, where: str) -> None:
    require_fields(o, ("project_id", *OVERVIEW_FIELDS, "evidence"), where)
    require_nonempty_str(o, "evidence", where)
    check_overview_content(o, where)
    # Claude may only copy paths it saw in the material: they must exist.
    missing = [o["paper"][f] for f in PAPER_PATHS if o["paper"] is not None and o["paper"][f] is not None
               and not Path(o["paper"][f]).exists()]
    if missing:
        raise ValidationError(f"{where} paper: paths {missing} do not exist")


def write_overviews(hub: Hub, lang: str) -> None:
    """source=claude overviews for the active projects without an overview.json; a source=me one is kept."""
    details = [hub.get_project(p["id"]) for p in hub.list_projects("active")]
    details = [d for d in details if not _overview_files(_project_dirs(
        d["project"]["repo_path"], [] if d["snapshot"] is None else d["snapshot"]["worktrees"]))]
    details = [d for d in details if d["project"]["overview"] is None or d["project"]["overview"]["source"] != "me"]
    if not details:
        return
    materials = [{**d, "docs": _status_docs(d["project"]["repo_path"])} for d in details]
    result = claude.ask_json(OVERVIEW_PROMPT.format(now=now_context(), projects=dump(materials), rules=user_text_rules(lang)),
                             OVERVIEW_SCHEMA)
    require_fields(result, ("overviews",), "claude overviews")
    wanted = sorted(d["project"]["id"] for d in details)
    got = sorted(o["project_id"] for o in result["overviews"])
    if got != wanted:
        raise ValidationError(f"claude overviews: project_ids {got} != {wanted}")
    for i, o in enumerate(result["overviews"]):
        _validate_overview(o, f"claude overviews[{i}]")
    for o in result["overviews"]:
        # The user may have edited it in chat while Claude was writing.
        current = hub.get_project(o["project_id"])["project"]["overview"]
        if current is not None and current["source"] == "me":
            continue
        hub.put_project_overview(o["project_id"], {
            "source": "claude",
            **{f: o[f] for f in OVERVIEW_FIELDS},
            "card": None,  # api.md 研究地图: only a project's own overview.json has a research card
            "checked_at": datetime.now(UTC).isoformat(),
            "status_file": None,
            "status_changed": False,
            "evidence": o["evidence"].strip(),
        })
