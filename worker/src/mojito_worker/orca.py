"""Orca, read-only: worktree/terminal overview and bounded terminal reads. Never sends input anywhere."""
import json
import re
import subprocess
from datetime import UTC, datetime

from mojito_worker.config import ORCA_BIN
from mojito_worker.local_facts import LocalFactError
from mojito_worker.redact import redact

TERMINAL_HANDLE = re.compile(r"^term_[0-9a-f-]+$")
READ_MAX_LINES = 200
PREVIEW_CHARS = 300


def _orca(*args: str) -> dict:
    proc = subprocess.run([ORCA_BIN, *args, "--json"], capture_output=True, text=True, timeout=60)
    if proc.returncode != 0:
        raise LocalFactError(f"orca {' '.join(args)}: {proc.stderr.strip()[:300]}")
    return json.loads(proc.stdout)["result"]


def _ms(ts: int | None) -> str | None:
    return None if ts is None else datetime.fromtimestamp(ts / 1000, UTC).isoformat()


def repos() -> list[dict]:
    return _orca("repo", "list")["repos"]


def worktrees() -> list[dict]:
    return [w for w in _orca("worktree", "list")["worktrees"] if not w["isArchived"]]


def terminals() -> list[dict]:
    return _orca("terminal", "list")["terminals"]


def ms_to_iso(ts: int | None) -> str | None:
    return _ms(ts)


def overview() -> dict:
    worktrees = _orca("worktree", "ps")["worktrees"]
    terminals = _orca("terminal", "list")["terminals"]
    return {
        "worktrees": [{
            "name": w["displayName"],
            "repo": w["repo"],
            "path": w["path"],
            "branch": w["branch"],
            "status": w["workspaceStatus"],
            "comment": w["comment"],
            "last_activity_at": _ms(w["lastActivityAt"]),
        } for w in worktrees if not w["isArchived"]],
        "terminals": [{
            "handle": t["handle"],
            "title": t["title"],
            "worktree_path": t["worktreePath"],
            "agent": t["agentIdentity"] if "agentIdentity" in t else None,  # plain shells have none
            "last_output_at": _ms(t["lastOutputAt"]),
            "preview": redact(t["preview"])[:PREVIEW_CHARS],
        } for t in terminals],
    }


def terminal_read(handle: str, lines: int) -> list[str]:
    if not TERMINAL_HANDLE.match(handle):
        raise LocalFactError(f"bad terminal handle {handle!r}")
    tail = _orca("terminal", "read", "--terminal", handle, "--limit", str(min(lines, READ_MAX_LINES)))["terminal"]["tail"]
    return [redact(line) for line in tail]
