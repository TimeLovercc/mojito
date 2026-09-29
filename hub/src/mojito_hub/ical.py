"""Read-only Google Calendar via the private iCal link: fetch every 15 minutes, expand
recurrences, keep events from 1 day ago to 14 days ahead. A successful fetch is the
`google-calendar` heartbeat, so a broken feed shows up through the watchdog."""

import asyncio
import logging
import urllib.request
from datetime import date, datetime, timedelta

import icalendar
import recurring_ical_events

from . import config, db, health

INTERVAL_S = 15 * 60
SOURCE = "google-calendar"
SOURCE_INTERVAL_S = 3600
PAST = timedelta(days=1)
AHEAD = timedelta(days=14)

log = logging.getLogger("mojito_hub.calendar")
_lock = asyncio.Lock()  # one fetch at a time (timer and POST /calendar/refresh)


def _as_datetime(value: date | datetime) -> datetime:
    if isinstance(value, datetime):
        # Floating (zone-less) times are the user's local time.
        return value if value.tzinfo is not None else value.replace(tzinfo=db.DAY_TZ)
    return datetime.combine(value, datetime.min.time(), db.DAY_TZ)


def fetch(url: str, at: datetime) -> list[tuple]:
    """Network + parsing; runs in a thread. Returns rows for calendar_events."""
    with urllib.request.urlopen(url, timeout=60) as resp:
        cal = icalendar.Calendar.from_ical(resp.read())
    rows = []
    for ev in recurring_ical_events.of(cal).between(at - PAST, at + AHEAD):
        if "STATUS" in ev and str(ev["STATUS"]) == "CANCELLED":
            continue
        all_day = not isinstance(ev.start, datetime)
        # SUMMARY and LOCATION are optional in iCalendar.
        title = str(ev["SUMMARY"]) if "SUMMARY" in ev else "（无标题）"
        location = str(ev["LOCATION"]) if "LOCATION" in ev and str(ev["LOCATION"]) else None
        rows.append((str(ev["UID"]), db.ts(_as_datetime(ev.start)), db.ts(_as_datetime(ev.end)),
                     int(all_day), title, location))
    return rows


def store(rows: list[tuple], at: datetime) -> None:
    with db.conn:
        db.conn.execute("DELETE FROM calendar_events")
        db.conn.executemany(
            'INSERT INTO calendar_events (uid, start, "end", all_day, title, location)'
            " VALUES (?, ?, ?, ?, ?, ?)",
            rows,
        )
        db.heartbeat(SOURCE, SOURCE_INTERVAL_S, at)


async def refresh() -> int:
    """Fetch and store now; raises on fetch failure. Returns the number of events."""
    async with _lock:
        at = db.now()
        rows = await asyncio.to_thread(fetch, config.ICAL_URL, at)
        store(rows, at)
        return len(rows)


async def loop() -> None:
    while True:
        try:
            await refresh()
        except (OSError, ValueError) as e:
            # Network/HTTP (URLError/HTTPError are OSError) or iCal parse errors are not fatal
            # for the hub: reported as the source's health (pushed), and the missing heartbeat
            # raises an interrupt via the watchdog.
            log.exception("calendar fetch failed")
            if db.one("SELECT 1 FROM sources WHERE name = ?", SOURCE):
                health.report(SOURCE, "error", f"日历拉取失败：{type(e).__name__}", db.now())
        else:
            health.report(SOURCE, "ok", None, db.now())
        await asyncio.sleep(INTERVAL_S)
