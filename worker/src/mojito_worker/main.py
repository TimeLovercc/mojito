import logging
import time

import httpx

from mojito_worker import card_watch, research_runner
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


# Jobs that ran to the end but whose finish the hub refused because its watchdog had already put them back
# in the queue (running over 30 minutes, e.g. the Mac slept mid-job). The work is done, so when such a job
# is leased again it is only finished: running it twice would post a second chat reply or weekly summary,
# push the review digest again, and 409 on drafts, projects and plans the first run created.
done_but_requeued: set[str] = set()


def run_job(hub: Hub, job: dict) -> None:
    log.info("job %s kind=%s record_id=%s", job["id"], job["kind"], job["record_id"])
    if job["id"] in done_but_requeued:
        log.info("job %s ran to the end before the hub requeued it; finishing without running it again", job["id"])
    else:
        try:
            HANDLERS[job["kind"]](hub, job, language(hub))  # api.md 界面语言: every job reads settings first
        except Exception as e:  # any job failure is reported to the hub; the worker keeps running
            error = f"{type(e).__name__}: {e}"
            log.exception("job %s failed", job["id"])
            if not hub.finish_failed(job["id"], error):
                log.warning("job %s kind=%s failed, but the hub had already put it back in the queue (running over"
                            " 30 minutes, e.g. the Mac slept): this failure is void and the job will run again",
                            job["id"], job["kind"])
            return
    if not hub.finish_done(job["id"]):
        done_but_requeued.add(job["id"])
        log.warning("job %s kind=%s ran to the end, but the hub had already put it back in the queue (running over"
                    " 30 minutes, e.g. the Mac slept): this finish is void; when leased again it is finished"
                    " without running again", job["id"], job["kind"])
        return
    done_but_requeued.discard(job["id"])
    log.info("job %s done", job["id"])


def tick(hub: Hub, auth: AuthReporter, watchdog: MaintainerWatchdog) -> bool:
    """One loop iteration. Returns True if a job was processed."""
    research_runner.reap()
    hub.heartbeat(HEARTBEAT_INTERVAL_S)
    auth.check_gmail_if_due()
    try:
        watchdog.check_if_due()
    except Exception:  # the watchdog must never stop job processing; the traceback goes to the log
        log.exception("maintainer watchdog failed")
    try:
        card_watch.WATCH.check_if_due(hub)
    except Exception:  # same: a failed file check only goes to the log
        log.exception("card file check failed")
    job = hub.lease()
    if job is None:
        return False
    if job["kind"] == "research_run":
        research_runner.launch(hub, job)
    else:
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
