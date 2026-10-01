import logging
import time
from datetime import date

import httpx

from mojito_agent.config import HTTP_TIMEOUT_S, SOURCE_NAME, Config


log = logging.getLogger("mojito_agent.hub")

# A hub restart (deploy) answers 502/503/504 or refuses connections for a few seconds: back off and retry
# (~30 s in total) before treating the call as failed. Other 4xx/5xx are real answers and are not retried.
RETRY_DELAYS_S = (1, 2, 4, 8, 15)
RETRY_STATUSES = (502, 503, 504)
RETRY_ERRORS = (httpx.ConnectError, httpx.RemoteProtocolError)


class HubError(Exception):
    pass


class Hub:
    def __init__(self, config: Config):
        self.client = httpx.Client(
            base_url=config.hub_url,
            headers={"Authorization": f"Bearer {config.agent_token}"},
            timeout=HTTP_TIMEOUT_S,
        )

    def _send(self, method: str, path: str, **kwargs) -> httpx.Response:
        """One call with backoff over hub restarts; the last attempt's error or response is returned as is."""
        for delay in RETRY_DELAYS_S:
            try:
                resp = self.client.request(method, path, **kwargs)
            except RETRY_ERRORS as e:
                log.warning("%s %s: %s; retrying in %ss", method, path, type(e).__name__, delay)
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

    # ---- queue
    def heartbeat(self, expected_interval_s: int) -> None:
        self._request("POST", f"/sources/{SOURCE_NAME}/heartbeat", json={"expected_interval_s": expected_interval_s})

    def lease(self) -> dict | None:
        resp = self._request("POST", "/worker/lease")
        if resp.status_code == 204:
            return None
        return resp.json()

    def finish_done(self, job_id: str) -> None:
        self._request("POST", f"/worker/jobs/{job_id}/finish", json={"status": "done"})

    def finish_failed(self, job_id: str, error: str) -> None:
        self._request("POST", f"/worker/jobs/{job_id}/finish", json={"status": "failed", "error": error})

    def create_job(self, *, kind: str, runner: str, record_id: str | None) -> dict:
        return self._request("POST", "/worker/jobs", json={"kind": kind, "runner": runner, "record_id": record_id}).json()

    # ---- reads
    def get_record(self, record_id: str) -> dict:
        return self._request("GET", f"/records/{record_id}").json()

    def get_attachment(self, attachment_id: str) -> bytes:
        resp = self._request("GET", f"/attachments/{attachment_id}")
        if resp.headers["content-type"] != "image/jpeg":
            raise HubError(f"GET /attachments/{attachment_id}: content-type {resp.headers['content-type']!r}, expected image/jpeg")
        return resp.content

    def list_records(self, *, limit: int, before: str | None) -> list[dict]:
        params = {"limit": limit}
        if before is not None:
            params["before"] = before
        return self._request("GET", "/records", params=params).json()["records"]

    def list_chat(self, *, limit: int, item_id: str | None, project_id: str | None) -> list[dict]:
        params = {"limit": limit}
        if item_id is not None:
            params["item_id"] = item_id
        if project_id is not None:
            params["project_id"] = project_id
        return self._request("GET", "/chat", params=params).json()["records"]

    def get_item(self, item_id: str) -> dict:
        return self._request("GET", f"/items/{item_id}").json()

    def list_projects(self, *, status: str | None) -> list[dict]:
        """status None → the hub's default (active + paused)."""
        params = {} if status is None else {"status": status}
        return self._request("GET", "/projects", params=params).json()["projects"]

    def list_notes(self, *, limit: int) -> list[dict]:
        """The user's own notes (kind=note, author=me), newest first."""
        return self._request("GET", "/records", params={"limit": limit, "kind": "note", "author": "me"}).json()["records"]

    def list_taste(self) -> list[dict]:
        return self._request("GET", "/taste").json()["notes"]

    def get_project(self, project_id: str) -> dict:
        return self._request("GET", f"/projects/{project_id}").json()

    def list_items(self) -> list[dict]:
        return self._request("GET", "/items").json()["items"]

    def current_plan(self) -> dict | None:
        """GET /plans/current → {plan, goals, items}; None when there is no active plan (404)."""
        resp = self._send("GET", "/plans/current")
        if resp.status_code == 404:
            return None
        if resp.status_code >= 400:
            raise HubError(f"GET /plans/current -> {resp.status_code}: {resp.text}")
        return resp.json()

    def post_plan(self, *, plan_id: str, start: str, end: str, goal_ids: list[str], item_ids: list[str],
                  revises: str | None) -> dict:
        payload = {"id": plan_id, "start": start, "end": end, "goal_ids": goal_ids, "item_ids": item_ids, "revises": revises}
        return self._request("POST", "/plans", json=payload).json()

    def get_card(self, card_id: str) -> dict:
        return self._request("GET", f"/cards/{card_id}").json()

    def list_cards(self, *, limit: int, before: str | None, status: str | None) -> list[dict]:
        params = {"limit": limit}
        if before is not None:
            params["before"] = before
        if status is not None:
            params["status"] = status
        return self._request("GET", "/cards", params=params).json()["cards"]

    def list_sources(self) -> list[dict]:
        return self._request("GET", "/sources").json()["sources"]

    def auth_status(self) -> list[dict]:
        return self._request("GET", "/auth-status").json()["auth"]

    def list_goals(self) -> list[dict]:
        return self._request("GET", "/goals").json()["goals"]

    def today(self) -> dict:
        return self._request("GET", "/today").json()

    def calendar(self, start: date, end: date) -> list[dict]:
        params = {"from": start.isoformat(), "to": end.isoformat()}
        return self._request("GET", "/calendar", params=params).json()["events"]

    def get_settings(self) -> dict:
        return self._request("GET", "/settings").json()

    # ---- writes
    # Writes below (goals, plans, projects, card status, note links) get their "从 X 改成 Y" record + undo from the hub.
    def put_goal(self, goal_id: str, *, title: str, status: str) -> dict:
        return self._request("PUT", f"/goals/{goal_id}", json={"title": title, "status": status}).json()

    def put_plan(self, plan_id: str, *, start: str, end: str, goal_ids: list[str], item_ids: list[str]) -> dict:
        payload = {"start": start, "end": end, "goal_ids": goal_ids, "item_ids": item_ids}
        return self._request("PUT", f"/plans/{plan_id}", json=payload).json()

    def put_project(self, project_id: str, fields: dict) -> dict:
        return self._request("PUT", f"/projects/{project_id}", json=fields).json()

    def post_project(self, *, project_id: str, title: str, area: str, repo_path: str | None, goal_id: str | None) -> dict:
        payload = {"id": project_id, "title": title, "area": area, "repo_path": repo_path, "goal_id": goal_id}
        return self._request("POST", "/projects", json=payload).json()

    def set_card_status(self, card_id: str, status: str) -> dict:
        return self._request("POST", f"/cards/{card_id}/status", json={"status": status}).json()

    def link_record(self, record_id: str, *, item_id: str | None, project_id: str | None) -> dict:
        return self._request("POST", f"/records/{record_id}/link", json={"item_id": item_id, "project_id": project_id}).json()

    def post_taste(self, text: str) -> dict:
        return self._request("POST", "/taste", json={"text": text}).json()

    def post_feedback(self, *, body: str, attachment_ids: list[str], context: dict) -> dict:
        return self._request("POST", "/feedback", json={"body": body, "attachment_ids": attachment_ids, "context": context}).json()

    def post_feedback_message(self, feedback_id: str, *, body: str, attachment_ids: list[str]) -> dict:
        payload = {"body": body, "attachment_ids": attachment_ids}
        return self._request("POST", f"/feedback/{feedback_id}/messages", json=payload).json()

    def list_subscriptions(self) -> list[dict]:
        return self._request("GET", "/subscriptions").json()["subscriptions"]

    def set_subscription_enabled(self, sub_id: str, enabled: bool) -> dict:
        return self._request("POST", f"/subscriptions/{sub_id}/enabled", json={"enabled": enabled}).json()

    def put_subscription(self, sub_id: str, *, at: str, config: dict) -> dict:
        return self._request("PUT", f"/subscriptions/{sub_id}", json={"at": at, "config": config}).json()

    def put_settings(self, settings: dict) -> dict:
        return self._request("PUT", "/settings", json=settings).json()

    def put_item(self, item_id: str, fields: dict) -> dict:
        return self._request("PUT", f"/items/{item_id}", json=fields).json()

    def post_event(self, *, kind: str, tier: str, item_id: str | None, project_id: str | None, title: str, body: str,
                   evidence: str | None, undo: dict | None, category: str | None, smoke: bool) -> dict:
        # repo_path is only for sources that know a repo but not a project (Orca Stop hook); the agent always sends null.
        # smoke marks the reply to a deploy smoke-check message (api.md 部署冒烟检查): never pushed, hidden by default.
        payload = {"kind": kind, "tier": tier, "item_id": item_id, "project_id": project_id, "repo_path": None,
                   "title": title, "body": body, "evidence": evidence, "undo": undo, "smoke": smoke}
        # category is optional in the contract: absent means the hub infers it (chat / jobs / ...); only briefs set it.
        if category is not None:
            payload["category"] = category
        return self._request("POST", "/events", json=payload).json()

    def put_draft(self, draft_id: str, *, channel: str, to: str, subject: str | None, body: str, item_id: str | None) -> dict:
        payload = {"channel": channel, "to": to, "subject": subject, "body": body, "item_id": item_id}
        return self._request("PUT", f"/drafts/{draft_id}", json=payload).json()

    def put_auth_status(self, name: str, *, ok: bool, detail: str | None) -> None:
        self._request("PUT", f"/auth-status/{name}", json={"ok": ok, "detail": detail})

    def refresh_calendar(self) -> None:
        self._request("POST", "/calendar/refresh")
