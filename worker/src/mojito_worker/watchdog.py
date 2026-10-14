"""Mac-side watchdog for the maintainer session (design 0.4b, api.md 准绳落地).

Every CHECK_INTERVAL_S: if the `maintainer` source has been silent for >= LOST_AFTER and no replacement
was started in the last RELAUNCH_COOLDOWN, open a new claude terminal in the main checkout via Orca and
tell the user. This is the only write the Mac agent ever makes to Orca. "Started recently" is read from
the hub's own records, so a restarted worker does not open a second session.

Just after the Mac wakes (wall clock jumped > WAKE_GAP between two loop rounds) nothing is judged for
WAKE_GRACE: the old maintainer reports its heartbeat a few seconds after waking. A worker start counts as a
wake too: when launchd restarts the worker after a crash, the new process has no previous round to
compare with and would judge the maintainer lost in the same minute. Before opening a terminal,
a minimal `claude -p` call checks the Mac's Claude login; on an auth error no terminal is opened and the user
is asked to /login instead, at most once per LOGIN_ALERT_COOLDOWN (api.md 维护会话心跳与看门狗).
"""
import json
import logging
import subprocess
import time
from datetime import UTC, datetime, timedelta
from pathlib import Path

from mojito_worker import claude
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
# Wall-clock gap between two loop rounds that means the Mac slept (monotonic time stops during sleep), and
# how long after waking the watchdog judges nothing: the old maintainer heartbeats seconds after the wake,
# so judging in that minute opens a needless new session. The worker's start counts as a wake: a worker
# restarted by launchd after a crash would otherwise open a new session at once.
WAKE_GAP = timedelta(minutes=10)
WAKE_GRACE = timedelta(minutes=5)
# With an expired login the session the watchdog opens stops at "Login expired" while the user is told it took over.
LOGIN_TITLE = "Mac 上的 Claude 登录过期，请 /login"  # i18n key
LOGIN_ALERT_COOLDOWN = timedelta(minutes=60)
LOGIN_PROBE_SCHEMA = {
    "type": "object",
    "properties": {"ok": {"type": "string"}},
    "required": ["ok"],
    "additionalProperties": False,
}
# worker/src/mojito_worker/watchdog.py -> repository root (the main checkout when run by launchd).
MAIN_CHECKOUT = Path(__file__).resolve().parents[3]
TERMINAL_TITLE = "mojito 维护"
CLAUDE_COMMAND = "claude -n maint '你是 mojito 的维护会话。完整读 docs/maintainer.md 并照做。'"
CREATE_OUTPUT_CHARS = 2000  # how much of orca's reply goes into the log and the error
# `orca terminal create --json` gave up waiting for the Orca runtime, which already had the request. Each time
# this happened (10/1, 10/2, 10/3, right after the Mac woke) the terminal appeared 0-4 minutes later, so the
# launch counts as done: the record is written and the cooldown holds.
RUNTIME_TIMEOUT = "runtime_timeout"
# The same outcome reported as a runtime error: Orca answered {"code": "runtime_error",
# "message": "Timed out waiting for terminal handle after creation"} and the terminal was open.
RUNTIME_ERROR = "runtime_error"
HANDLE_TIMEOUT_MESSAGE = "Timed out waiting for terminal handle"

log = logging.getLogger("mojito_worker.watchdog")


class MaintainerWatchdog:
    def __init__(self, hub: Hub):
        self.hub = hub
        self.checked_at: float | None = None
        self.last_round_at: datetime | None = None   # wall clock of the previous loop round
        self.woke_at = datetime.now(UTC)  # a restarted worker cannot tell whether the Mac just woke
        log.info("worker 刚启动，按刚醒处理：%s 之前不判失联", self.woke_at + WAKE_GRACE)

    def check_if_due(self) -> None:
        wall = datetime.now(UTC)
        if self.last_round_at is not None and wall - self.last_round_at > WAKE_GAP:
            self.woke_at = wall
            log.info("wall clock jumped %s since the last round: Mac just woke, not judging until %s",
                     wall - self.last_round_at, wall + WAKE_GRACE)
        self.last_round_at = wall
        now = time.monotonic()
        if self.checked_at is not None and now - self.checked_at < CHECK_INTERVAL_S:
            return
        self.checked_at = now
        self.check()

    def check(self) -> None:
        if datetime.now(UTC) - self.woke_at < WAKE_GRACE:
            return  # just woke: the old maintainer may not have heartbeated yet
        sources = {s["name"]: s for s in self.hub.list_sources()}
        if MAINTAINER not in sources:
            return  # never registered: nothing to judge yet
        src = sources[MAINTAINER]
        now = datetime.now(UTC)
        if src["alive"] or (src["last_seen_at"] is not None and now - datetime.fromisoformat(src["last_seen_at"]) < LOST_AFTER):
            return
        if self._recorded_since(RELAUNCH_TITLE, now - RELAUNCH_COOLDOWN):
            return
        seen = src["last_seen_at"]
        lang = language(self.hub)
        lost = (say(lang, "维护会话超过 30 分钟没有心跳（上次 {at}），", at=short_time(seen)) if seen is not None
                else say(lang, "维护会话一直没有心跳，"))
        if not self._claude_logged_in():
            if self._recorded_since(LOGIN_TITLE, now - LOGIN_ALERT_COOLDOWN):
                return
            self.hub.post_event(kind="alert", tier="digest", item_id=None, project_id=None,
                                title=say(lang, LOGIN_TITLE),
                                body=lost + say(lang, "新会话没有开：在 Mac 任一终端运行 claude，按提示 /login；登录好后看门狗会自动开新会话。"),
                                evidence="claude-mac:auth")
            return
        confirmed = self._launch()
        if confirmed:
            body = lost + say(lang, "已在 mojito 主 worktree 开了新的维护会话接班，它会先读交接文档再继续。")
        else:
            body = lost + say(lang, "已请 Orca 在 mojito 主 worktree 开新的维护会话接班；Orca 回复超时，新会话可能几分钟后才出现。")
        self.hub.post_event(kind="alert", tier="digest", item_id=None, project_id=None,
                            title=say(lang, RELAUNCH_TITLE), body=body,
                            evidence="orca:terminal:create" if confirmed else f"orca:terminal:create:{RUNTIME_TIMEOUT}")

    def _recorded_since(self, title_key: str, since: datetime) -> bool:
        """The worker wrote a record titled `title_key` (in either language) at or after `since`."""
        titles = {say(lang, title_key) for lang in LANGUAGES}
        return any(r["source"] == "worker" and r["title"] in titles and datetime.fromisoformat(r["at"]) >= since
                   for r in self.hub.list_records(RECORD_SCAN, None))

    def _claude_logged_in(self) -> bool:
        """False only on an auth error from a minimal claude -p call; any other failure (network, timeout)
        says nothing about the login, so the terminal is still opened."""
        try:
            claude.ask_json('只回复 {"ok": "ok"}。', LOGIN_PROBE_SCHEMA)
        except claude.ClaudeAuthError as e:
            log.warning("maintainer silent but Claude on the Mac is logged out: %s", e)
            return False
        except claude.ClaudeError as e:
            log.warning("claude login probe failed for another reason, opening the terminal anyway: %s", e)
        return True

    def _launch(self) -> bool:
        """Open the replacement terminal. True when Orca returned its handle; False when Orca's reply timed
        out after it took the request (the terminal shows up later). Any other failure raises."""
        cmd = [ORCA_BIN, "terminal", "create", "--worktree", f"path:{MAIN_CHECKOUT}",
               "--title", TERMINAL_TITLE, "--command", CLAUDE_COMMAND, "--json"]
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
        if proc.returncode == 0:
            log.warning("maintainer silent; opened a new maintainer terminal: %s", proc.stdout.strip()[:200])
            return True
        stdout = proc.stdout.strip()[:CREATE_OUTPUT_CHARS]
        log.error("orca terminal create exited %s; stdout: %s; stderr: %s",
                  proc.returncode, stdout, proc.stderr.strip()[:CREATE_OUTPUT_CHARS])
        # With --json, orca writes its reply to stdout, errors included: {"ok": false, "error": {"code", ...}}.
        try:
            reply = json.loads(proc.stdout)
        except json.JSONDecodeError as e:
            raise RuntimeError(f"orca terminal create exited {proc.returncode}, stdout is not JSON: {stdout}") from e
        if reply["ok"]:
            log.warning("maintainer silent; orca exited %s but returned terminal %s", proc.returncode,
                        reply["result"]["terminal"]["handle"])
            return True
        error = reply["error"]
        if error["code"] == RUNTIME_TIMEOUT or (
                error["code"] == RUNTIME_ERROR and error["message"].startswith(HANDLE_TIMEOUT_MESSAGE)):
            log.warning("maintainer silent; orca took the terminal request but its reply timed out (%s)", error["code"])
            return False
        raise RuntimeError(f"orca terminal create failed ({error['code']}): {stdout}")

