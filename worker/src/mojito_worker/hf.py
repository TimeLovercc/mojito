"""Hugging Face daily papers (public API)."""
import httpx

API = "https://huggingface.co/api/daily_papers"
LIMIT = 100
TIMEOUT_S = 60


def daily_papers() -> list[dict]:
    """The latest daily list, as papers keyed by arXiv id (same shape as arxiv._paper where it matters)."""
    resp = httpx.get(API, params={"limit": LIMIT}, timeout=TIMEOUT_S)
    resp.raise_for_status()
    return [{
        "id": e["paper"]["id"],
        "title": " ".join(e["paper"]["title"].split()),
        "abstract": " ".join(e["paper"]["summary"].split()),
        "authors": [a["name"] for a in e["paper"]["authors"]],
        "upvotes": e["paper"]["upvotes"],
        "link": f"https://arxiv.org/abs/{e['paper']['id']}",
    } for e in resp.json()]
