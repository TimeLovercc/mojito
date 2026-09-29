"""Google Calendar writes for the agent (primary calendar, scope calendar.events).

Create / update only ever touch events carrying extendedProperties.private.mojito = "1". Delete may target any event
(design 8.5); a deleted event is restored from the stored `before` on undo.
"""
import os
from datetime import date, datetime

import google.auth.exceptions
import google.auth.transport.requests
import httpx
from google.oauth2.credentials import Credentials

from mojito_agent.config import HTTP_TIMEOUT_S, TIMEZONE

SCOPES = ["https://www.googleapis.com/auth/calendar.events"]
CALENDAR_API = "https://www.googleapis.com/calendar/v3/calendars/primary"
MARKER_KEY = "mojito"
MARKER_VALUE = "1"
# Fields of a Google event resource that the agent writes and restores on undo.
RESTORABLE_FIELDS = ("summary", "start", "end", "location", "description", "extendedProperties")


class CalendarError(Exception):
    pass


class CalendarUnavailable(Exception):
    """Calendar writes are not possible right now: the credentials file is missing or its grant no longer refreshes.
    `detail` is what goes to /auth-status (missing / OAuth error code), never token contents; callers word it for the
    user in their language."""

    def __init__(self, detail: str):
        super().__init__(f"google calendar unavailable: {detail}")
        self.detail = detail


class EventNotFound(CalendarError):
    pass


class EventAmbiguous(CalendarError):
    def __init__(self, count: int):
        super().__init__(f"{count} events match")
        self.count = count


def access_token(oauth_path: str) -> str:
    """Exchange the refresh token for an access token. oauth_path: google-auth authorized-user JSON (creds.to_json()),
    loaded fresh each time because the file is runtime state (it can be absent while being re-authorized).
    Refreshed in memory only, never written back. Network failures propagate as google.auth TransportError."""
    if not os.path.exists(oauth_path):
        raise CalendarUnavailable("missing")
    creds = Credentials.from_authorized_user_file(oauth_path, scopes=SCOPES)
    try:
        creds.refresh(google.auth.transport.requests.Request())
    except google.auth.exceptions.RefreshError as e:
        raise CalendarUnavailable(refresh_error_type(e)) from e
    return creds.token


def refresh_error_type(e: Exception) -> str:
    """OAuth error code from a RefreshError (e.g. invalid_grant) for auth-status detail; never token contents."""
    if len(e.args) > 1 and isinstance(e.args[1], dict) and "error" in e.args[1]:
        return e.args[1]["error"]
    return type(e).__name__


def is_mojito(event: dict) -> bool:
    # Google omits extendedProperties / private entirely when unset.
    if "extendedProperties" not in event or "private" not in event["extendedProperties"]:
        return False
    private = event["extendedProperties"]["private"]
    return MARKER_KEY in private and private[MARKER_KEY] == MARKER_VALUE


def time_field(value: str) -> dict:
    """"YYYY-MM-DD" → all-day {date}; ISO datetime with offset → {dateTime, timeZone}."""
    if len(value) == 10:
        return {"date": date.fromisoformat(value).isoformat()}
    parsed = datetime.fromisoformat(value)
    if parsed.tzinfo is None:
        raise CalendarError(f"datetime {value!r} has no timezone")
    return {"dateTime": parsed.isoformat(), "timeZone": TIMEZONE}


def restorable(event: dict) -> dict:
    """The subset of a Google event stored in undo.before; absent optional fields become null."""
    return {f: event[f] if f in event else None for f in RESTORABLE_FIELDS}


def _same_start(event: dict, start: str) -> bool:
    """Does the Google event start at `start` (hub Event start: datetime, all-day as 00:00 in the owner's timezone)?"""
    if "date" in event["start"]:
        return datetime.fromisoformat(start).date() == date.fromisoformat(event["start"]["date"])
    return datetime.fromisoformat(event["start"]["dateTime"]) == datetime.fromisoformat(start)


def brief(event: dict) -> dict:
    """Compact view for prompts and record bodies."""
    return {
        "event_id": event["id"],
        "title": event["summary"],
        "start": event["start"]["dateTime"] if "dateTime" in event["start"] else event["start"]["date"],
        "end": event["end"]["dateTime"] if "dateTime" in event["end"] else event["end"]["date"],
        "location": event["location"] if "location" in event else None,
    }


class GoogleCalendar:
    def __init__(self, oauth_path: str):
        self.client = httpx.Client(
            base_url=CALENDAR_API,
            headers={"Authorization": f"Bearer {access_token(oauth_path)}"},
            timeout=HTTP_TIMEOUT_S,
        )

    def _request(self, method: str, path: str, **kwargs) -> httpx.Response:
        resp = self.client.request(method, path, **kwargs)
        if resp.status_code >= 400:
            raise CalendarError(f"{method} {path} -> {resp.status_code}: {resp.text}")
        return resp

    def list_mojito(self, start: datetime, end: datetime) -> list[dict]:
        params = {
            "privateExtendedProperty": f"{MARKER_KEY}={MARKER_VALUE}",
            "timeMin": start.isoformat(),
            "timeMax": end.isoformat(),
            "singleEvents": "true",
            "orderBy": "startTime",
        }
        return self._request("GET", "/events", params=params).json()["items"]

    def get(self, event_id: str) -> dict:
        return self._request("GET", f"/events/{event_id}").json()

    def find_instance(self, uid: str, start: str, window_start: datetime, window_end: datetime) -> dict:
        """The one event, or the one occurrence of a recurring event, with this iCal UID starting at `start` (the start
        as the hub lists it). Recurring occurrences share the UID, so only that occurrence is ever returned."""
        params = {"iCalUID": uid, "singleEvents": "true", "timeMin": window_start.isoformat(), "timeMax": window_end.isoformat()}
        events = [e for e in self._request("GET", "/events", params=params).json()["items"] if _same_start(e, start)]
        if not events:
            raise EventNotFound(f"no event {uid} at {start}")
        if len(events) > 1:
            raise EventAmbiguous(len(events))
        return events[0]

    def get_mojito(self, event_id: str) -> dict:
        event = self._request("GET", f"/events/{event_id}").json()
        if not is_mojito(event):
            raise CalendarError(f"event {event_id} is not a mojito event; refusing to touch it")
        return event

    def create(self, fields: dict, footer: str) -> dict:
        """fields: summary/start/end/location/description (location/description may be null). Adds the mojito marker
        and `footer` (the "created by mojito" line, in the user's language) at the end of the description."""
        body = {k: v for k, v in fields.items() if v is not None}
        description = fields["description"]
        if description is None:
            body["description"] = footer
        elif not description.endswith(footer):
            body["description"] = f"{description}\n{footer}"
        body["extendedProperties"] = {"private": {MARKER_KEY: MARKER_VALUE}}
        return self._request("POST", "/events", json=body).json()

    def restore(self, before: dict) -> dict:
        """Re-insert a deleted event from undo.before (gets a new id). Records written before extendedProperties was
        stored only ever held mojito events, so those get the marker back."""
        body = {k: v for k, v in before.items() if v is not None}
        if "extendedProperties" not in before:
            body["extendedProperties"] = {"private": {MARKER_KEY: MARKER_VALUE}}
        return self._request("POST", "/events", json=body).json()

    def patch(self, event_id: str, fields: dict) -> dict:
        return self._request("PATCH", f"/events/{event_id}", json=fields).json()

    def delete(self, event_id: str) -> None:
        self._request("DELETE", f"/events/{event_id}")
