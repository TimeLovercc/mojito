import logging
import time

import httpx

from mojito_worker.config import HTTP_TIMEOUT_S, Config

# While the hub restarts (a few seconds on deploy) the proxy answers 502/503/504 or the connection is
# refused. Those requests never reached the hub, so retrying them is safe even for POSTs. Timeouts are
# NOT retried: the hub may have processed the request.
RETRY_STATUSES = (502, 503, 504)
RETRY_ERRORS = (httpx.ConnectError, httpx.RemoteProtocolError)
RETRY_DELAYS_S = (1, 2, 4, 8, 15)

log = logging.getLogger("mojito_worker.hub")

# Item fields the hub computes itself; never sent back on PUT /items/{id}.
HUB_COMPUTED_ITEM_FIELDS = ("id", "forgotten", "updated_at", "updated_by")


class HubError(Exception):
    pass


class Hub:
    def __init__(self, config: Config):
        self.client = httpx.Client(
            base_url=config.hub_url,
            headers={"Authorization": f"Bearer {config.worker_token}"},
            timeout=HTTP_TIMEOUT_S,
        )

    def _send(self, method: str, path: str, **kwargs) -> httpx.Response:
        """One request with backoff over hub restarts; the last attempt's error/response is returned as is."""
        for delay in RETRY_DELAYS_S:
            try:
                resp = self.client.request(method, path, **kwargs)
            except RETRY_ERRORS as e:
                log.warning("%s %s: %s; retrying in %ss", method, path, e, delay)
            else:
                if resp.status_code not in RETRY_STATUSES:
                    return resp
                log.warning("%s %s -> %s; retrying in %ss", method, path, resp.status_code, delay)
            time.sleep(delay)
        return self.client.request(method, path, **kwargs)

    def _request(self, method: str, path: str, **kwargs) -> httpx.Response:
        resp = self._send(method, path, **kwargs)
        if resp.status_code >= 400:
            raise HubError(f"{method} {path} -> {resp.status_code}: {resp.text}")
        return resp

    def lease(self) -> dict | None:
        resp = self._request("POST", "/worker/lease")
        if resp.status_code == 204:
            return None
        return resp.json()

    def finish_done(self, job_id: str) -> None:
        self._request("POST", f"/worker/jobs/{job_id}/finish", json={"status": "done"})

    def finish_failed(self, job_id: str, error: str) -> None:
        self._request("POST", f"/worker/jobs/{job_id}/finish", json={"status": "failed", "error": error})

    def create_job(self, kind: str, runner: str, record_id: str | None) -> dict:
        """Enqueue a job; the hub returns the queued/running one of that kind instead of a duplicate."""
        return self._request("POST", "/worker/jobs", json={"kind": kind, "runner": runner, "record_id": record_id}).json()

    def heartbeat(self, expected_interval_s: int) -> None:
        self.source_heartbeat("worker", expected_interval_s)

    def source_heartbeat(self, source: str, expected_interval_s: int) -> None:
        self._request("POST", f"/sources/{source}/heartbeat", json={"expected_interval_s": expected_interval_s})

    def get_record(self, record_id: str) -> dict:
        return self._request("GET", f"/records/{record_id}").json()

    def list_records(self, limit: int, before: str | None) -> list[dict]:
        params = {"limit": limit} if before is None else {"limit": limit, "before": before}
        return self._request("GET", "/records", params=params).json()["records"]

    def list_chat(self, limit: int, item_id: str | None, project_id: str | None) -> list[dict]:
        params = {"limit": limit}
        if item_id is not None:
            params["item_id"] = item_id
        if project_id is not None:
            params["project_id"] = project_id
        return self._request("GET", "/chat", params=params).json()["records"]

    def get_today(self) -> dict:
        return self._request("GET", "/today").json()

    def put_draft(self, draft_id: str, fields: dict) -> dict:
        return self._request("PUT", f"/drafts/{draft_id}", json=fields).json()

    def get_current_plan(self) -> dict:
        return self._request("GET", "/plans/current").json()

    def list_plans(self) -> list[dict]:
        return self._request("GET", "/plans").json()["plans"]

    def get_plan(self, plan_id: str) -> dict:
        return self._request("GET", f"/plans/{plan_id}").json()

    def put_review(self, plan_id: str, fields: dict) -> dict:
        return self._request("PUT", f"/reviews/{plan_id}", json=fields).json()

    def post_plan(self, fields: dict) -> dict:
        return self._request("POST", "/plans", json=fields).json()

    def list_projects(self, status: str) -> list[dict]:
        return self._request("GET", "/projects", params={"status": status}).json()["projects"]

    def get_project(self, project_id: str) -> dict:
        return self._request("GET", f"/projects/{project_id}").json()

    def put_project(self, project_id: str, fields: dict) -> dict:
        return self._request("PUT", f"/projects/{project_id}", json=fields).json()

    def put_snapshot(self, project_id: str, snapshot: dict) -> dict:
        return self._request("PUT", f"/projects/{project_id}/snapshot", json=snapshot).json()

    def put_project_overview(self, project_id: str, overview: dict) -> dict:
        return self._request("PUT", f"/projects/{project_id}/overview", json=overview).json()

    def put_project_summary(self, project_id: str, summary: str, evidence: str) -> dict:
        return self._request("PUT", f"/projects/{project_id}/summary",
                             json={"summary": summary, "summary_evidence": evidence}).json()

    def put_auth_status(self, name: str, ok: bool, detail: str | None) -> dict:
        return self._request("PUT", f"/auth-status/{name}", json={"ok": ok, "detail": detail}).json()

    def usage_summary(self, date_from: str, date_to: str) -> dict:
        return self._request("GET", "/usage/summary", params={"from": date_from, "to": date_to}).json()

    def get_attachment(self, attachment_id: str) -> bytes:
        resp = self._request("GET", f"/attachments/{attachment_id}")
        if resp.headers["content-type"] != "image/jpeg":
            raise HubError(f"attachment {attachment_id}: content-type {resp.headers['content-type']!r}, expected image/jpeg")
        return resp.content

    def post_card(self, fields: dict) -> dict | None:
        """Publish a card; None when this dedupe_key was already published (409), e.g. a re-run."""
        resp = self._send("POST", "/cards", json=fields)
        if resp.status_code == 409:
            return None
        if resp.status_code >= 400:
            raise HubError(f"POST /cards -> {resp.status_code}: {resp.text}")
        return resp.json()

    def list_cards(self, limit: int, status: str) -> list[dict]:
        return self._request("GET", "/cards", params={"limit": limit, "status": status}).json()["cards"]

    def post_attachment(self, jpeg: bytes) -> dict:
        return self._request("POST", "/attachments", files={"file": ("cover.jpg", jpeg, "image/jpeg")}).json()

    def list_subscriptions(self) -> list[dict]:
        return self._request("GET", "/subscriptions").json()["subscriptions"]

    def put_subscription(self, subscription_id: str, at: str, config: dict) -> dict:
        return self._request("PUT", f"/subscriptions/{subscription_id}", json={"at": at, "config": config}).json()

    def set_subscription_enabled(self, subscription_id: str, enabled: bool) -> dict:
        return self._request("POST", f"/subscriptions/{subscription_id}/enabled", json={"enabled": enabled}).json()

    def post_subscription_result(self, subscription_id: str, result: str, health: str) -> None:
        self._request("POST", f"/subscriptions/{subscription_id}/result", json={"result": result, "health": health})

    def list_recent_cards(self, limit: int) -> list[dict]:
        """New + saved cards, newest first (GET /cards without status)."""
        return self._request("GET", "/cards", params={"limit": limit}).json()["cards"]

    def get_card(self, card_id: str) -> dict:
        return self._request("GET", f"/cards/{card_id}").json()

    def put_goal(self, goal_id: str, fields: dict) -> dict:
        return self._request("PUT", f"/goals/{goal_id}", json=fields).json()

    def create_project(self, fields: dict) -> dict:
        return self._request("POST", "/projects", json=fields).json()

    def put_plan(self, plan_id: str, fields: dict) -> dict:
        return self._request("PUT", f"/plans/{plan_id}", json=fields).json()

    def get_settings(self) -> dict:
        return self._request("GET", "/settings").json()

    def put_settings(self, settings: dict) -> dict:
        return self._request("PUT", "/settings", json=settings).json()

    def set_card_status(self, card_id: str, status: str) -> dict:
        return self._request("POST", f"/cards/{card_id}/status", json={"status": status}).json()

    def link_record(self, record_id: str, item_id: str | None, project_id: str | None) -> dict:
        return self._request("POST", f"/records/{record_id}/link", json={"item_id": item_id, "project_id": project_id}).json()

    def get_taste(self) -> list[dict]:
        return self._request("GET", "/taste").json()["notes"]

    def post_taste(self, text: str) -> dict:
        return self._request("POST", "/taste", json={"text": text}).json()

    def list_sources(self) -> list[dict]:
        return self._request("GET", "/sources").json()["sources"]

    def post_health(self, source: str, health: str, detail: str | None) -> None:
        self._request("POST", f"/sources/{source}/health", json={"health": health, "detail": detail})

    def metrics(self, date_from: str, date_to: str) -> dict:
        return self._request("GET", "/metrics", params={"from": date_from, "to": date_to}).json()

    def calendar(self, date_from: str, date_to: str) -> list[dict]:
        return self._request("GET", "/calendar", params={"from": date_from, "to": date_to}).json()["events"]

    def list_goals(self) -> list[dict]:
        return self._request("GET", "/goals").json()["goals"]

    def list_items(self) -> list[dict]:
        return self._request("GET", "/items").json()["items"]

    def get_item(self, item_id: str) -> dict:
        return self._request("GET", f"/items/{item_id}").json()

    def put_item(self, item_id: str, fields: dict) -> dict:
        return self._request("PUT", f"/items/{item_id}", json=fields).json()

    def post_event(self, *, kind: str, tier: str, item_id: str | None, project_id: str | None,
                   title: str, body: str, evidence: str | None) -> dict:
        # repo_path is for sources that only know a directory (Orca hook); the worker always knows project_id.
        payload = {"kind": kind, "tier": tier, "item_id": item_id, "project_id": project_id, "repo_path": None,
                   "title": title, "body": body, "evidence": evidence}
        return self._request("POST", "/events", json=payload).json()


def writable_item_fields(item: dict) -> dict:
    return {k: v for k, v in item.items() if k not in HUB_COMPUTED_ITEM_FIELDS}
