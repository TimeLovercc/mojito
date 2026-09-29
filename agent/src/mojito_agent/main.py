import logging
import signal
import time

import google.auth.exceptions
import httpx

from mojito_agent import claude
from mojito_agent import gcal
from mojito_agent.config import AUTH_CHECK_INTERVAL_S, HEARTBEAT_INTERVAL_S, POLL_INTERVAL_S, Config, load_config
from mojito_agent.hub import Hub
from mojito_agent.jobs import HANDLERS

log = logging.getLogger("mojito_agent")


def run_job(hub: Hub, config: Config, job: dict) -> None:
    log.info("job %s kind=%s record_id=%s", job["id"], job["kind"], job["record_id"])
    try:
        HANDLERS[job["kind"]](hub, config, job)
    except Exception as e:  # any job failure is reported to the hub; the agent keeps running
        error = f"{type(e).__name__}: {e}"
        log.exception("job %s failed", job["id"])
        hub.finish_failed(job["id"], error)
        return
    hub.finish_done(job["id"])
    log.info("job %s done", job["id"])


def check_google(hub: Hub, config: Config) -> None:
    """Startup + hourly: can the calendar refresh token still get an access token?"""
    try:
        gcal.access_token(config.google_oauth)
    except gcal.CalendarUnavailable as e:
        log.warning("google-calendar-write unavailable: %s", e.detail)
        hub.put_auth_status("google-calendar-write", ok=False, detail=e.detail)
        return
    hub.put_auth_status("google-calendar-write", ok=True, detail=None)


class ClaudeAuthReporter:
    """Reports claude-server auth status only when it may have changed (hub dedups anyway)."""

    def __init__(self):
        self.reported: bool | None = None

    def sync(self, hub: Hub) -> None:
        state = claude.last_auth_ok
        if state is None or state == self.reported:
            return
        hub.put_auth_status("claude-server", ok=state, detail=None if state else "authentication_error")
        self.reported = state


def tick(hub: Hub, config: Config) -> bool:
    """One loop iteration: heartbeat, lease at most one job, run it. Returns True if a job was processed."""
    hub.heartbeat(HEARTBEAT_INTERVAL_S)
    job = hub.lease()
    if job is None:
        return False
    run_job(hub, config, job)
    return True


def on_sigterm(signum, frame) -> None:
    """systemctl stop: exit 0. A running job is abandoned (its claude -p child killed, no finish);
    the hub watchdog puts it back to queued after 30 minutes. SystemExit is not caught by run_job.

    systemd signals the whole cgroup and `uv run` forwards its own SIGTERM too, so a second one lands a few ms later.
    CPython restores SIG_DFL for Python-handled signals while finalizing, so that second signal would kill us (143);
    ignoring SIGTERM from here on (SIG_IGN survives finalization) keeps the exit at 0."""
    signal.signal(signal.SIGTERM, signal.SIG_IGN)
    log.info("SIGTERM: stopping (claude -p running: %s)", claude.is_running())
    claude.terminate_running()
    raise SystemExit(0)


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    logging.getLogger("httpx").setLevel(logging.WARNING)
    signal.signal(signal.SIGTERM, on_sigterm)
    config = load_config()
    hub = Hub(config)
    log.info("agent started, hub=%s claude=%s", config.hub_url, config.claude_bin)
    claude_auth = ClaudeAuthReporter()
    next_google_check = time.monotonic()
    while True:
        try:
            if time.monotonic() >= next_google_check:
                check_google(hub, config)
                next_google_check = time.monotonic() + AUTH_CHECK_INTERVAL_S
            worked = tick(hub, config)
            claude_auth.sync(hub)
        except (httpx.TransportError, google.auth.exceptions.TransportError) as e:  # hub or Google unreachable: retry next round
            log.warning("unreachable: %s", e)
            worked = False
        if not worked:
            time.sleep(POLL_INTERVAL_S)
