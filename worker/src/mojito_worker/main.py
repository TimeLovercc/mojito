import logging
import time

import httpx

from mojito_worker.auth import AuthReporter
from mojito_worker.chat import chat_reply
from mojito_worker.config import HEARTBEAT_INTERVAL_S, POLL_INTERVAL_S, load_config
from mojito_worker.feed import feed_weekly
from mojito_worker.hub import Hub
from mojito_worker.i18n import language
from mojito_worker.jobs import process_note, refresh
from mojito_worker.mail_feed import feed_mail
from mojito_worker.projects import sync_projects
from mojito_worker.reports import feed_brief, feed_watch
from mojito_worker.review import draft_review
from mojito_worker.watchdog import MaintainerWatchdog
from mojito_worker.weekly import weekly_summary

log = logging.getLogger("mojito_worker")

HANDLERS = {
    "chat_reply": chat_reply,
    "process_note": process_note,
    "refresh": refresh,
    "draft_review": draft_review,
    "weekly_summary": weekly_summary,
    "sync_projects": sync_projects,
    "feed_brief": feed_brief,
    "feed_watch": feed_watch,
    "feed_weekly": feed_weekly,
    "feed_mail": feed_mail,
}


def run_job(hub: Hub, job: dict) -> None:
    log.info("job %s kind=%s record_id=%s", job["id"], job["kind"], job["record_id"])
    try:
        HANDLERS[job["kind"]](hub, job, language(hub))  # api.md 界面语言: every job reads settings first
    except Exception as e:  # any job failure is reported to the hub; the worker keeps running
        error = f"{type(e).__name__}: {e}"
        log.exception("job %s failed", job["id"])
        hub.finish_failed(job["id"], error)
        return
    hub.finish_done(job["id"])
    log.info("job %s done", job["id"])


def tick(hub: Hub, auth: AuthReporter, watchdog: MaintainerWatchdog) -> bool:
    """One loop iteration. Returns True if a job was processed."""
    hub.heartbeat(HEARTBEAT_INTERVAL_S)
    auth.check_gmail_if_due()
    try:
        watchdog.check_if_due()
    except Exception:  # the watchdog must never stop job processing; the traceback goes to the log
        log.exception("maintainer watchdog failed")
    job = hub.lease()
    if job is None:
        return False
    run_job(hub, job)
    auth.report_claude_if_changed()
    return True


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    logging.getLogger("httpx").setLevel(logging.WARNING)
    config = load_config()
    hub = Hub(config)
    auth = AuthReporter(hub)
    watchdog = MaintainerWatchdog(hub)
    log.info("worker started, hub=%s", config.hub_url)
    while True:
        try:
            worked = tick(hub, auth, watchdog)
        except httpx.TransportError as e:  # hub unreachable (Mac just woke, network down): retry next round
            log.warning("hub unreachable: %s", e)
            worked = False
        if not worked:
            time.sleep(POLL_INTERVAL_S)
