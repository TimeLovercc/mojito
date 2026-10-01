"""Web news for the reports (api.md 信息流改成报告), fetched by script: Google News RSS search, in the
English and the Chinese edition. Claude only judges what comes back; it never browses.

Google News links are redirects (news.google.com/rss/articles/<id>); `resolve` turns the ones a report cites
into the publisher's URL the way the news.google.com page does (its signature + batchexecute). A link that
cannot be resolved stays as it is (api.md 补充 4).
"""
import json
import logging
import re
import xml.etree.ElementTree as ET
from datetime import UTC, datetime
from email.utils import parsedate_to_datetime

import httpx

from mojito_worker.config import HTTP_TIMEOUT_S

log = logging.getLogger("mojito_worker.news")

SEARCH_URL = "https://news.google.com/rss/search"
ARTICLE_PREFIX = "https://news.google.com/rss/articles/"
DECODE_URL = "https://news.google.com/_/DotsSplashUi/data/batchexecute"
PAGE_SIGNATURE = re.compile(r'data-n-a-sg="([^"]+)"')
PAGE_TIMESTAMP = re.compile(r'data-n-a-ts="([^"]+)"')
BROWSER_HEADERS = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
                                 "(KHTML, like Gecko) Chrome/140.0 Safari/537.36"}
EDITIONS = ({"hl": "en-US", "gl": "US", "ceid": "US:en"}, {"hl": "zh-CN", "gl": "CN", "ceid": "CN:zh-Hans"})
PER_QUERY = 10


def search(query: str, since: datetime) -> list[dict]:
    """Articles matching `query` published at or after `since`, both editions, newest first, deduped by link."""
    hours = max(1, int((datetime.now(UTC) - since).total_seconds() // 3600) + 1)
    found: dict[str, dict] = {}
    with httpx.Client(timeout=HTTP_TIMEOUT_S, follow_redirects=True) as client:
        for edition in EDITIONS:
            resp = client.get(SEARCH_URL, params={"q": f"{query} when:{hours}h", **edition})
            resp.raise_for_status()
            items = ET.fromstring(resp.content).findall("./channel/item")
            for item in items[:PER_QUERY]:
                published = parsedate_to_datetime(item.findtext("pubDate"))
                if published < since:
                    continue
                found[item.findtext("link")] = {
                    "title": item.findtext("title"),
                    "source": item.findtext("source"),
                    "published_at": published.isoformat(),
                    "url": item.findtext("link"),
                }
    return sorted(found.values(), key=lambda a: a["published_at"], reverse=True)


class ResolveError(Exception):
    pass


def _decode(client: httpx.Client, url: str) -> str:
    article_id = url.removeprefix(ARTICLE_PREFIX).split("?")[0]
    page = client.get(ARTICLE_PREFIX + article_id)
    page.raise_for_status()
    signature, timestamp = PAGE_SIGNATURE.search(page.text), PAGE_TIMESTAMP.search(page.text)
    if signature is None or timestamp is None:
        raise ResolveError("no signature on the article page")
    request = ["Fbv4je", json.dumps([
        "garturlreq",
        [["X", "X", ["X", "X"], None, None, 1, 1, "US:en", None, 1, None, None, None, None, None, 0, 1],
         "X", "X", 1, [1, 1, 1], 1, 1, None, 0, 0, None, 0],
        article_id, int(timestamp[1]), signature[1],
    ]), None, "generic"]
    resp = client.post(DECODE_URL, data={"f.req": json.dumps([[request]])},
                       headers={"Content-Type": "application/x-www-form-urlencoded;charset=UTF-8"})
    resp.raise_for_status()
    parts = resp.text.split("\n\n", 1)
    if len(parts) != 2:
        raise ResolveError(f"unexpected batchexecute response: {resp.text[:200]}")
    decoded = json.loads(json.loads(parts[1])[0][2])[1]
    if not isinstance(decoded, str) or not decoded.startswith("http"):
        raise ResolveError(f"decoded to {decoded!r}")
    return decoded


def resolve(urls: list[str]) -> dict[str, str]:
    """url -> publisher URL for Google News links; other links and unresolvable ones map to themselves."""
    resolved = {u: u for u in urls}
    with httpx.Client(timeout=HTTP_TIMEOUT_S, follow_redirects=True, headers=BROWSER_HEADERS) as client:
        for url in {u for u in urls if u.startswith(ARTICLE_PREFIX)}:
            try:
                resolved[url] = _decode(client, url)
            except (httpx.HTTPError, ResolveError, json.JSONDecodeError, IndexError, TypeError) as e:
                log.warning("google news link kept as is (%s): %s", e, url)
    return resolved
