"""Subscriptions (api.md 订阅, 信息流改成报告): the hub enqueues feed_brief / feed_watch / feed_mail by each
subscription's `at`; after every run the worker reports `POST /subscriptions/{id}/result`."""
from collections.abc import Callable

from mojito_worker.hub import Hub

KINDS = ("brief", "watch", "mail")
RESULT_CHARS = 300


def by_kind(hub: Hub, kind: str) -> dict:
    matches = [s for s in hub.list_subscriptions() if s["kind"] == kind]
    if len(matches) != 1:
        raise LookupError(f"expected exactly one subscription of kind {kind!r}, got {matches}")
    return matches[0]


def run(hub: Hub, kind: str, lang: str, feed: Callable[[Hub, dict, str], tuple[str, str]]) -> tuple[str, str]:
    """Run `feed(hub, subscription, lang) -> (health, result)` and report the result; a failure is reported as
    error and re-raised so the job fails too."""
    sub = by_kind(hub, kind)
    try:
        health, result = feed(hub, sub, lang)
    except Exception as e:
        hub.post_subscription_result(sub["id"], f"{type(e).__name__}: {e}"[:RESULT_CHARS], "error")
        raise
    hub.post_subscription_result(sub["id"], result[:RESULT_CHARS], health)
    return health, result
