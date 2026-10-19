"""Sync project cards within a minute of a file change (api.md 研究地图 → 卡片文件一改就同步).

Every CHECK_INTERVAL (wall clock) the main loop stats the files sync_projects reads: overview.json in each
project directory the last sync looked at, the MOJITO_RESEARCH_MAP file, and curated research skill
directories and Markdown files. No contents are read or fetched.
A file that appeared, disappeared or has a new mtime enqueues sync_projects (the hub returns the queued /
running one instead of a duplicate) and becomes the new baseline. sync_projects rebuilds the baseline
before it reads the files. The directory list is also kept in STATE_DIR, so a restarted worker watches the
same files from its first check; that first check only records the baseline.
"""
import json
import logging
import os
from datetime import UTC, datetime, timedelta
from pathlib import Path

from mojito_worker.config import STATE_DIR
from mojito_worker.hub import Hub
from mojito_worker.overview import OVERVIEW_FILE
from mojito_worker.research_skills import watch_paths

CHECK_INTERVAL = timedelta(seconds=60)
DIRS_FILE = STATE_DIR / "card_dirs.json"

log = logging.getLogger("mojito_worker.card_watch")


def _research_map_file() -> Path:
    return Path(os.environ["MOJITO_RESEARCH_MAP"])


def _mtimes(paths: list[Path]) -> dict[str, float | None]:
    """path -> mtime, None for a missing file."""
    return {str(p): p.stat().st_mtime if p.exists() else None for p in paths}


class CardFileWatch:
    def __init__(self):
        self.dirs: list[str] = json.loads(DIRS_FILE.read_text()) if DIRS_FILE.exists() else []
        self.baseline: dict[str, float | None] | None = None   # None until the first check or sync
        self.checked_at: datetime | None = None

    def _paths(self) -> list[Path]:
        return [Path(d) / OVERVIEW_FILE for d in self.dirs] + [_research_map_file()] + watch_paths()

    def rebuild(self, dirs: list[str]) -> None:
        """Called by sync_projects before it reads the files: these directories, mtimes as of now."""
        self.dirs = list(dict.fromkeys(dirs))
        STATE_DIR.mkdir(exist_ok=True)
        DIRS_FILE.write_text(json.dumps(self.dirs, ensure_ascii=False, indent=2))
        self.baseline = _mtimes(self._paths())

    def check_if_due(self, hub: Hub) -> None:
        now = datetime.now(UTC)
        if self.checked_at is not None and now - self.checked_at < CHECK_INTERVAL:
            return
        self.checked_at = now
        seen = _mtimes(self._paths())
        if self.baseline is None:  # first check since the worker started: baseline only
            self.baseline = seen
            return
        changed = sorted(set(seen) ^ set(self.baseline))
        changed += [p for p in seen.keys() & self.baseline.keys() if seen[p] != self.baseline[p]]
        if not changed:
            return
        job = hub.create_job("sync_projects", "mac", None)
        log.info("card files changed %s: sync_projects %s (%s)", changed, job["id"], job["status"])
        self.baseline = seen


WATCH = CardFileWatch()
