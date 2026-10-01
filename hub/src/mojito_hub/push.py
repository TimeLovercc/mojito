"""Push for records with tier interrupt/digest/quiet over two channels: FCM (Android app) and
Web Push (iPhone PWA). Only the title (plus ids) goes out; details stay in the hub. A channel
without registered devices/subscriptions sends nothing (the record still exists).

Each channel runs as its own asyncio task (sending in worker threads, then dropping tokens /
subscriptions the service reports as gone); failures are logged per channel by the task
callback and never affect the API or the other channel.
Must be called from the event-loop thread (all hub code is)."""

import asyncio
import json
import logging
from urllib.parse import urlencode

from . import config, db, fcm, labels, webpush
from .models import Record

log = logging.getLogger("mojito_hub.push")
_tasks: set[asyncio.Task] = set()  # keep strong refs until done



def push_data(record: Record) -> dict[str, str]:
    """Shared data of both channels. Values must be strings (FCM); item_id and card_id are
    omitted when null. reply=true marks agent chat messages (e.g. the evening question) the app can answer."""
    data = {
        "record_id": record.id, "headline": record.title, "tier": record.tier, "kind": record.kind,
        "reply": "true" if record.kind == "chat" and record.author == "system" else "false",
    }
    if record.item_id is not None:
        data["item_id"] = record.item_id
    if record.card_id is not None:
        data["card_id"] = record.card_id
    return data


def webpush_payload(record: Record) -> dict:
    """Declarative Web Push message (api.md 推送载荷)."""
    query = {"record_id": record.id, "kind": record.kind}
    if record.item_id is not None:
        query["item_id"] = record.item_id
    if record.card_id is not None:
        query["card_id"] = record.card_id
    return {
        "web_push": 8030,
        "notification": {
            "title": labels.name("category", record.category),
            "body": record.title,
            "navigate": f"{config.PUBLIC_URL}/app/open?{urlencode(query)}",
            "silent": record.tier == "quiet",
            "data": push_data(record),
        },
    }


async def _fcm(record: Record, tokens: list[str]) -> None:
    gone = await asyncio.to_thread(fcm.send, tokens, push_data(record), record.tier != "quiet")
    if gone:
        with db.conn:
            db.conn.executemany("DELETE FROM devices WHERE fcm_token = ?", [(t,) for t in gone])
        log.warning("dropped %d unregistered FCM device(s)", len(gone))


async def _webpush(record: Record, subs: list[dict]) -> None:
    plaintext = json.dumps(webpush_payload(record), ensure_ascii=False).encode()
    if len(plaintext) > webpush.MAX_PLAINTEXT:
        log.error("Web Push failed: payload of record %s is %d bytes (> %d), not sent",
                  record.id, len(plaintext), webpush.MAX_PLAINTEXT)
        return
    gone, errors = await asyncio.get_running_loop().run_in_executor(
        webpush.EXECUTOR, webpush.send, subs, plaintext, record.tier)
    if gone:
        with db.conn:
            db.conn.executemany("DELETE FROM webpush_subscriptions WHERE endpoint = ?", [(e,) for e in gone])
        log.warning("dropped %d expired Web Push subscription(s)", len(gone))
    for line in errors:
        log.error("Web Push failed: %s", line)


def _done(channel: str):
    def callback(task: asyncio.Task) -> None:
        _tasks.discard(task)
        if not task.cancelled() and task.exception() is not None:
            log.error("%s failed", channel, exc_info=task.exception())
    return callback


def _start(coro, channel: str) -> None:
    task = asyncio.get_running_loop().create_task(coro)
    _tasks.add(task)
    task.add_done_callback(_done(channel))


def push(record: Record) -> None:
    if record.tier == "log" or record.smoke:
        return  # smoke records are never pushed (api.md 冒烟标记)
    notify = json.loads(db.one("SELECT notify FROM settings WHERE id = 1")["notify"])
    if not notify[record.category]:
        return  # the user turned this category off; the record itself stays
    tokens = [r["fcm_token"] for r in db.all_("SELECT fcm_token FROM devices")]
    if tokens:
        _start(_fcm(record, tokens), "FCM push")
    subs = [dict(r) for r in db.all_("SELECT endpoint, p256dh, auth FROM webpush_subscriptions")]
    if subs:
        _start(_webpush(record, subs), "Web Push")
