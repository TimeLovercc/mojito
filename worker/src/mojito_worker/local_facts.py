"""Read-only local facts for the Mac agent: git repos under PROJECTS_ROOT, their commits and files."""
import fnmatch
import subprocess
from pathlib import Path

from mojito_worker.config import PROJECTS_ROOT

REPO_SEARCH_DEPTH = 4
SKIP_DIRS = {".git", "node_modules", ".venv", "__pycache__", ".expo", "dist"}
RECENT_COMMITS_DAYS = 7
RECENT_COMMITS_PER_REPO = 15
FIND_FILES_LIMIT = 60
READ_FILE_MAX_BYTES = 20_000
GIT_LOG_MAX = 50


class LocalFactError(Exception):
    """A query the planner asked for could not be answered; reported back to Claude, not fatal."""


def _has_commits(repo: Path) -> bool:
    return subprocess.run(["git", "-C", str(repo), "rev-parse", "--verify", "-q", "HEAD"], capture_output=True).returncode == 0


def find_repos() -> dict[str, Path]:
    """Map repo name (path relative to PROJECTS_ROOT) -> repo dir; repos without any commit are left out."""
    repos = {}
    frontier = [PROJECTS_ROOT]
    for _ in range(REPO_SEARCH_DEPTH):
        next_frontier = []
        for d in frontier:
            for child in sorted(d.iterdir()):
                if not child.is_dir() or child.name in SKIP_DIRS or child.name.startswith("."):
                    continue
                if (child / ".git").exists() and _has_commits(child):
                    repos[str(child.relative_to(PROJECTS_ROOT))] = child
                next_frontier.append(child)
        frontier = next_frontier
    return repos


def _git(repo: Path, *args: str) -> str:
    proc = subprocess.run(["git", "-C", str(repo), *args], capture_output=True, text=True, timeout=30)
    if proc.returncode != 0:
        raise LocalFactError(f"git {' '.join(args)} in {repo}: {proc.stderr.strip()}")
    return proc.stdout


def _log(repo: Path, *extra: str) -> list[str]:
    out = _git(repo, "log", "--date=iso-strict", "--pretty=format:%h %ad %an: %s", *extra)
    return [line for line in out.splitlines() if line]


def recent_commits(repos: dict[str, Path], days: int) -> dict[str, list[str]]:
    """Commits from the last `days` days, only for repos that have any."""
    result = {}
    for name, path in repos.items():
        lines = _log(path, f"--since={days}.days.ago", "-n", str(RECENT_COMMITS_PER_REPO))
        if lines:
            result[name] = lines
    return result


def _repo(repos: dict[str, Path], name: str) -> Path:
    if name not in repos:
        raise LocalFactError(f"unknown repo {name!r}; known: {sorted(repos)}")
    return repos[name]


def git_log(repos: dict[str, Path], repo: str, n: int) -> list[str]:
    return _log(_repo(repos, repo), "-n", str(min(n, GIT_LOG_MAX)))


def find_files(repos: dict[str, Path], repo: str | None, pattern: str) -> list[str]:
    """Tracked files whose repo-relative path matches a case-insensitive glob (or substring)."""
    targets = {repo: _repo(repos, repo)} if repo is not None else repos
    glob = pattern.lower() if any(c in pattern for c in "*?[") else f"*{pattern.lower()}*"
    matches = []
    for name, path in targets.items():
        for f in _git(path, "ls-files").splitlines():
            if fnmatch.fnmatch(f.lower(), glob):
                matches.append(f"{name}/{f}")
                if len(matches) >= FIND_FILES_LIMIT:
                    return matches
    return matches


def read_file(repos: dict[str, Path], path: str) -> str:
    """Read a git-tracked file given as "<repo>/<path in repo>" (untracked files such as .env are refused)."""
    repo = max((name for name in repos if path.startswith(name + "/")), key=len, default=None)
    if repo is None:
        raise LocalFactError(f"{path!r} is not under a known repo; known: {sorted(repos)}")
    rel = path[len(repo) + 1:]
    tracked = subprocess.run(["git", "-C", str(repos[repo]), "ls-files", "--error-unmatch", "--", rel], capture_output=True)
    if tracked.returncode != 0:
        raise LocalFactError(f"{path!r} is not a git-tracked file")
    full = repos[repo] / rel
    data = full.read_bytes()
    if b"\0" in data[:READ_FILE_MAX_BYTES]:
        raise LocalFactError(f"{path!r} is binary")
    text = data[:READ_FILE_MAX_BYTES].decode("utf-8", errors="replace")
    if len(data) > READ_FILE_MAX_BYTES:
        text += f"\n…（截断，全文 {len(data)} 字节）"
    return text
