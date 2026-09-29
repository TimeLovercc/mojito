"""Gmail, read-only (gmail.readonly). The refreshed access token is never written back to the file."""
import base64
import re

import google.auth.exceptions
import google.auth.transport.requests
import httpx
from google.oauth2.credentials import Credentials

from mojito_worker.config import GOOGLE_OAUTH_FILE, HTTP_TIMEOUT_S
from mojito_worker.local_facts import LocalFactError
from mojito_worker.redact import redact

API = "https://gmail.googleapis.com/gmail/v1/users/me"
SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"]
SEARCH_MAX = 20
LIST_PAGE = 100
BODY_MAX_CHARS = 20_000


def access_token() -> str:
    """Exchange the stored refresh token for a fresh access token (not written back to the file)."""
    if not GOOGLE_OAUTH_FILE.is_file():
        raise LocalFactError(f"Gmail 还没接上：缺凭据文件 {GOOGLE_OAUTH_FILE}")
    creds = Credentials.from_authorized_user_file(str(GOOGLE_OAUTH_FILE), SCOPES)
    creds.refresh(google.auth.transport.requests.Request())
    return creds.token


def refresh_error_code(e: "google.auth.exceptions.RefreshError") -> str:
    """OAuth error code only (e.g. invalid_grant) — never token material."""
    return str(e.args[0]).split(":", 1)[0].strip()


class Gmail:
    def __init__(self):
        self._client: httpx.Client | None = None

    def _http(self) -> httpx.Client:
        if self._client is None:
            try:
                token = access_token()
            except google.auth.exceptions.RefreshError as e:
                raise LocalFactError(f"Gmail 授权失效（{refresh_error_code(e)}），这类暂时查不了") from e
            self._client = httpx.Client(
                base_url=API, headers={"Authorization": f"Bearer {token}"}, timeout=HTTP_TIMEOUT_S
            )
        return self._client

    def _get(self, path: str, **params) -> dict:
        resp = self._http().get(path, params=params)
        if resp.status_code >= 400:
            raise LocalFactError(f"Gmail GET {path} -> {resp.status_code}: {resp.text[:300]}")
        return resp.json()

    def search(self, query: str, n: int) -> list[dict]:
        """Gmail search syntax (e.g. `from:alice newer_than:7d`) -> message headers + snippet."""
        listing = self._get("/messages", q=query, maxResults=min(n, SEARCH_MAX))
        if "messages" not in listing:  # Gmail omits the key when nothing matches
            return []
        return [summarize(self._get(f"/messages/{m['id']}", format="metadata",
                                    metadataHeaders=["From", "To", "Subject", "Date"]))
                for m in listing["messages"]]

    def received_since(self, after_unix: int, limit: int) -> list[dict]:
        """Headers + snippet of mail received after `after_unix`, newest first (sent/drafts/chats excluded)."""
        query = f"after:{after_unix} -in:sent -in:drafts -in:chats"
        ids: list[str] = []
        params = {"q": query, "maxResults": min(limit, LIST_PAGE)}
        while len(ids) < limit:
            listing = self._get("/messages", **params)
            if "messages" not in listing:  # Gmail omits the key when nothing matches
                break
            ids += [m["id"] for m in listing["messages"]]
            if "nextPageToken" not in listing:
                break
            params["pageToken"] = listing["nextPageToken"]
        return [summarize(self._get(f"/messages/{i}", format="metadata",
                                    metadataHeaders=["From", "To", "Subject", "Date"]))
                for i in ids[:limit]]

    def read(self, message_id: str) -> dict:
        msg = self._get(f"/messages/{message_id}", format="full")
        return {**summarize(msg), "body": redact(message_text(msg["payload"]))[:BODY_MAX_CHARS]}


def _headers(payload: dict) -> dict[str, str]:
    return {h["name"].lower(): h["value"] for h in payload["headers"]}


def summarize(msg: dict) -> dict:
    headers = _headers(msg["payload"])
    return {
        "id": msg["id"],
        "thread_id": msg["threadId"],
        "from": headers["from"],
        "to": headers["to"] if "to" in headers else None,
        "subject": headers["subject"] if "subject" in headers else None,
        "date": headers["date"],
        "labels": msg["labelIds"],
        "snippet": msg["snippet"],
    }


def _decode(data: str) -> str:
    return base64.urlsafe_b64decode(data + "=" * (-len(data) % 4)).decode("utf-8", errors="replace")


def _parts(payload: dict):
    yield payload
    for part in payload["parts"] if "parts" in payload else []:
        yield from _parts(part)


def message_text(payload: dict) -> str:
    """Prefer text/plain parts; otherwise strip tags from text/html."""
    parts = [p for p in _parts(payload) if "data" in p["body"]]
    plain = [_decode(p["body"]["data"]) for p in parts if p["mimeType"] == "text/plain"]
    if plain:
        return "\n".join(plain)
    html = [_decode(p["body"]["data"]) for p in parts if p["mimeType"] == "text/html"]
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", "\n".join(html))).strip()
