"""Task-type data sources the worker reports for (api.md 补充 1): after each run, heartbeat the source
(first heartbeat registers it) and then report result health for the system page."""
from mojito_worker.hub import Hub

FEED_PAPERS = "feed-papers"      # the brief's paper material (api.md 信息流改成报告 → feed_brief)
SYNC_PROJECTS = "sync-projects"
EXPECTED_INTERVAL_S = {FEED_PAPERS: 93600, SYNC_PROJECTS: 3600}


def report(hub: Hub, source: str, health: str, detail: str | None) -> None:
    hub.source_heartbeat(source, EXPECTED_INTERVAL_S[source])
    hub.post_health(source, health, detail)


def report_error(hub: Hub, source: str, e: Exception) -> None:
    report(hub, source, "error", f"{type(e).__name__}: {e}"[:300])
