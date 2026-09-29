"""Mac-side watchdog for the maintainer session (design 0.4b, api.md 准绳落地).

Every CHECK_INTERVAL_S: if the `maintainer` source has been silent for >= LOST_AFTER and no replacement
was started in the last RELAUNCH_COOLDOWN, open a new claude terminal in the main checkout via Orca and
tell the user. This is the only write the Mac agent ever makes to Orca. "Started recently" is read from
the hub's own records, so a restarted worker does not open a second session.
"""
import logging
import subprocess
import time
from datetime import UTC, datetime, timedelta
from pathlib import Path

from mojito_worker.config import ORCA_BIN
from mojito_worker.hub import Hub
from mojito_worker.i18n import LANGUAGES, language, say
from mojito_worker.prompting import short_time

MAINTAINER = "maintainer"
CHECK_INTERVAL_S = 300
LOST_AFTER = timedelta(minutes=30)
RELAUNCH_COOLDOWN = timedelta(minutes=60)
RECORD_SCAN = 100
RELAUNCH_TITLE = "维护会话失联，已开新会话接班"  # i18n key; the record is written in settings.language
# worker/src/mojito_worker/watchdog.py -> repository root (the main checkout when run by launchd).
MAIN_CHECKOUT = Path(__file__).resolve().parents[3]
TERMINAL_TITLE = "mojito 维护"
CLAUDE_COMMAND = "claude '你是 mojito 的维护会话。完整读 docs/maintainer.md 并照做。'"

log = logging.getLogger("mojito_worker.watchdog")


class MaintainerWatchdog:
    def __init__(self, hub: Hub):
        self.hub = hub
        self.checked_at: float | None = None

    def check_if_due(self) -> None:
        now = time.monotonic()
        if self.checked_at is not None and now - self.checked_at < CHECK_INTERVAL_S:
            return
        self.checked_at = now
        self.check()

    def check(self) -> None:
        sources = {s["name"]: s for s in self.hub.list_sources()}
        if MAINTAINER not in sources:
            return  # never registered: nothing to judge yet
        src = sources[MAINTAINER]
        now = datetime.now(UTC)
        if src["alive"] or (src["last_seen_at"] is not None and now - datetime.fromisoformat(src["last_seen_at"]) < LOST_AFTER):
            return
        if self._relaunched_since(now - RELAUNCH_COOLDOWN):
            return
        self._launch()
        seen = src["last_seen_at"]
        lang = language(self.hub)
        lost = (say(lang, "维护会话超过 30 分钟没有心跳（上次 {at}），", at=short_time(seen)) if seen is not None
                else say(lang, "维护会话一直没有心跳，"))
        body = lost + say(lang, "已在 mojito 主 worktree 开了新的维护会话接班，它会先读交接文档再继续。")
        self.hub.post_event(kind="alert", tier="digest", item_id=None, project_id=None,
                            title=say(lang, RELAUNCH_TITLE), body=body, evidence="orca:terminal:create")

    def _relaunched_since(self, since: datetime) -> bool:
        titles = {say(lang, RELAUNCH_TITLE) for lang in LANGUAGES}
        return any(r["source"] == "worker" and r["title"] in titles and datetime.fromisoformat(r["at"]) >= since
                   for r in self.hub.list_records(RECORD_SCAN, None))

    def _launch(self) -> None:
        cmd = [ORCA_BIN, "terminal", "create", "--worktree", f"path:{MAIN_CHECKOUT}",
               "--title", TERMINAL_TITLE, "--command", CLAUDE_COMMAND, "--json"]
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
        if proc.returncode != 0:
            raise RuntimeError(f"orca terminal create failed: {proc.stderr.strip()[:300]}")
        log.warning("maintainer silent; opened a new maintainer terminal: %s", proc.stdout.strip()[:200])

