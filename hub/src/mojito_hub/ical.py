"""Read-only calendars via iCal links: the Google Calendar private link plus the subscribed
calendars listed in MOJITO_ICAL_EXTRA_FILE (api.md 订阅日历). Fetch every 15 minutes, expand
recurrences, keep events from 1 day ago to 14 days ahead. A successful fetch of the main
calendar is the `google-calendar` heartbeat, so a broken feed shows up through the watchdog.
The links are secrets: logs and errors name the host only."""

import asyncio
import logging
import urllib.error
import urllib.request
from datetime import date, datetime, timedelta
from urllib.parse import urlsplit

import icalendar
import recurring_ical_events

from . import config, db, health

INTERVAL_S = 15 * 60
SOURCE = "google-calendar"
SOURCE_INTERVAL_S = 3600
PAST = timedelta(days=1)
AHEAD = timedelta(days=14)
COLUMNS = 'uid, start, "end", all_day, title, location, read_only, feed'

log = logging.getLogger("mojito_hub.calendar")
_lock = asyncio.Lock()  # one fetch at a time (timer and POST /calendar/refresh)


def describe(e: Exception) -> str:
    """A fetch failure without its message where urllib may quote a URL (redirect errors)."""
    if isinstance(e, urllib.error.HTTPError):
        return f"HTTP {e.code}"
    if isinstance(e, urllib.error.URLError):
        return f"URLError: {e.reason}"
    return f"{type(e).__name__}: {e}"


def _as_datetime(value: date | datetime) -> datetime:
    if isinstance(value, datetime):
        # Floating (zone-less) times are the user's local time.
        return value if value.tzinfo is not None else value.replace(tzinfo=db.DAY_TZ)
    return datetime.combine(value, datetime.min.time(), db.DAY_TZ)


def fetch(url: str, read_only: bool, at: datetime) -> list[tuple]:
    """Network + parsing; runs in a thread. Returns rows for calendar_events (COLUMNS)."""
    with urllib.request.urlopen(url, timeout=60) as resp:
        cal = icalendar.Calendar.from_ical(resp.read())
    feed = config.token_ref(url)
    rows = []
    for ev in recurring_ical_events.of(cal).between(at - PAST, at + AHEAD):
        if "STATUS" in ev and str(ev["STATUS"]) == "CANCELLED":
            continue
        all_day = not isinstance(ev.start, datetime)
        # SUMMARY and LOCATION are optional in iCalendar.
        title = str(ev["SUMMARY"]) if "SUMMARY" in ev else "（无标题）"
        location = str(ev["LOCATION"]) if "LOCATION" in ev and str(ev["LOCATION"]) else None
        rows.append((str(ev["UID"]), db.ts(_as_datetime(ev.start)), db.ts(_as_datetime(ev.end)),
                     int(all_day), title, location, int(read_only), feed))
    return rows


def dedupe(rows: list[tuple]) -> list[tuple]:
    """One event per uid + start; the main calendar's copy wins (read_only 0 sorts first)."""
    kept = {}
    for row in sorted(rows, key=lambda r: r[6]):
        kept.setdefault((row[0], row[1]), row)
    return list(kept.values())


def store(rows: list[tuple], at: datetime) -> None:
    with db.conn:
        db.conn.execute("DELETE FROM calendar_events")
        db.conn.executemany(f"INSERT INTO calendar_events ({COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", rows)
        db.heartbeat(SOURCE, SOURCE_INTERVAL_S, at)


async def refresh() -> list[str]:
    """Fetch and store now; raises when the main calendar fails. A failed subscribed calendar
    keeps its previously stored events and is returned by host."""
    async with _lock:
        at = db.now()
        rows = await asyncio.to_thread(fetch, config.ICAL_URL, False, at)
        failed = []
        for url in config.ical_extra_urls():
            try:
                rows += await asyncio.to_thread(fetch, url, True, at)
            except (OSError, ValueError) as e:
                host = urlsplit(url).hostname
                log.warning("subscribed calendar %s fetch failed: %s", host, describe(e))
                failed.append(host)
                rows += [tuple(r) for r in db.all_(f"SELECT {COLUMNS} FROM calendar_events WHERE feed = ?",
                                                   config.token_ref(url))]
        store(dedupe(rows), at)
        return failed


async def loop() -> None:
    while True:
        try:
            failed = await refresh()
        except (OSError, ValueError) as e:
            # Network/HTTP (URLError/HTTPError are OSError), iCal parse errors or a bad
            # MOJITO_ICAL_EXTRA_FILE are not fatal for the hub: reported as the source's health
            # (pushed), and the missing heartbeat raises an interrupt via the watchdog.
            log.warning("calendar fetch failed: %s", describe(e))
            if db.one("SELECT 1 FROM sources WHERE name = ?", SOURCE):
                health.report(SOURCE, "error", f"日历拉取失败：{type(e).__name__}", db.now())
        else:
            if failed:
                health.report(SOURCE, "warn", "订阅日历读取失败：" + "、".join(failed), db.now())
            else:
                health.report(SOURCE, "ok", None, db.now())
        await asyncio.sleep(INTERVAL_S)
