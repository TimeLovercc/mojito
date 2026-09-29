"""arXiv public API (export.arxiv.org): new submissions in a time window. Polite: one connection,
3 s between requests, as the API terms ask."""
import time
import xml.etree.ElementTree as ET
from datetime import datetime

import httpx

API = "https://export.arxiv.org/api/query"
PAGE = 500
GAP_S = 3
TIMEOUT_S = 120
NS = {"a": "http://www.w3.org/2005/Atom", "os": "http://a9.com/-/spec/opensearch/1.1/",
      "arxiv": "http://arxiv.org/schemas/atom"}


_last_request: float | None = None


def _get(client: httpx.Client, params: dict) -> ET.Element:
    """One API request, at least GAP_S after the previous one in this process."""
    global _last_request
    if _last_request is not None:
        wait = GAP_S - (time.monotonic() - _last_request)
        if wait > 0:
            time.sleep(wait)
    try:
        resp = client.get(API, params=params)
    finally:
        _last_request = time.monotonic()
    resp.raise_for_status()
    return ET.fromstring(resp.content)


def _stamp(t: datetime) -> str:
    return t.strftime("%Y%m%d%H%M")  # arXiv submittedDate is GMT


def _text(el: ET.Element, path: str) -> str:
    return " ".join(el.find(path, NS).text.split())


def _paper(entry: ET.Element) -> dict:
    abs_url = entry.find("a:id", NS).text.strip()           # http://arxiv.org/abs/2401.00001v1
    versioned = abs_url.rsplit("/abs/", 1)[1]
    arxiv_id = versioned.rsplit("v", 1)[0]
    return {
        "id": arxiv_id,
        "title": _text(entry, "a:title"),
        "abstract": _text(entry, "a:summary"),
        "authors": [_text(a, "a:name") for a in entry.findall("a:author", NS)],
        "categories": [c.get("term") for c in entry.findall("a:category", NS)],
        "published": entry.find("a:published", NS).text,
        "link": f"https://arxiv.org/abs/{arxiv_id}",
    }


def submitted_between(categories: tuple[str, ...], start: datetime, end: datetime) -> list[dict]:
    """All papers in `categories` submitted in [start, end) (UTC datetimes), newest first."""
    cats = " OR ".join(f"cat:{c}" for c in categories)
    return _query(f"({cats}) AND submittedDate:[{_stamp(start)} TO {_stamp(end)}]")


def by_authors(authors: list[str], start: datetime, end: datetime, batch: int) -> list[dict]:
    """Papers by any of `authors` submitted in [start, end); `batch` authors are OR-ed per request."""
    papers: list[dict] = []
    for i in range(0, len(authors), batch):
        names = " OR ".join(f'au:"{a}"' for a in authors[i:i + batch])
        papers.extend(_query(f"({names}) AND submittedDate:[{_stamp(start)} TO {_stamp(end)}]"))
    return papers


def _query(query: str) -> list[dict]:
    papers: list[dict] = []
    with httpx.Client(timeout=TIMEOUT_S, headers={"User-Agent": "mojito-worker/0.1"}) as client:
        while True:
            feed = _get(client, {"search_query": query, "start": len(papers), "max_results": PAGE,
                                 "sortBy": "submittedDate", "sortOrder": "descending"})
            total = int(feed.find("os:totalResults", NS).text)
            entries = feed.findall("a:entry", NS)
            papers.extend(_paper(e) for e in entries)
            if not entries or len(papers) >= total:
                return papers
