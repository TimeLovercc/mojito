"""Taste profile for the paper feed (facts only, gathered by script).

Main signals (api.md 简化): the user's taste notes and the cards they asked about ("问问这个", chat
messages with a card_id). Also: the Zotero library (MOJITO_ZOTERO_DB, for authors and recent additions,
opened read-only and immutable so a running Zotero is not disturbed; `none` = no Zotero signals), active
project summaries, and saved/dismissed cards (still readable, no longer produced by the app).
"""
import sqlite3
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path

from mojito_worker.config import ZOTERO_DB
from mojito_worker.hub import Hub

FOLLOW_MIN_PAPERS = 3        # an author with >= this many papers in Zotero is followed
QUERY_AUTHORS = 50           # the most frequent followed authors also get a direct arXiv author query
PROFILE_AUTHORS = 40
RECENT_ZOTERO = 40
CARD_SIGNALS = 40
CHAT_SCAN = 300              # recent chat messages scanned for "问问这个" card questions
EVIDENCE_TITLES = 5          # Zotero titles per followed author shown to Claude to tell them from namesakes
NO_ZOTERO = ZOTERO_DB == "none"


def _ro() -> sqlite3.Connection:
    return sqlite3.connect(f"file:{Path(ZOTERO_DB).expanduser()}?mode=ro&immutable=1", uri=True)


def _zotero_authors() -> list[tuple[str, int]]:
    if NO_ZOTERO:
        return []
    with _ro() as con:
        rows = con.execute("""
            SELECT trim(c.firstName || ' ' || c.lastName), COUNT(DISTINCT ic.itemID) AS n
            FROM itemCreators ic JOIN creators c USING (creatorID) JOIN creatorTypes ct USING (creatorTypeID)
            WHERE ct.creatorType = 'author' AND ic.itemID NOT IN (SELECT itemID FROM deletedItems)
            GROUP BY c.firstName, c.lastName HAVING n >= ? ORDER BY n DESC""", (FOLLOW_MIN_PAPERS,)).fetchall()
    return rows


def author_evidence(names: set[str]) -> dict[str, dict]:
    """lower-cased author name -> {titles: their Zotero paper titles, coauthors: lower-cased co-author names},
    to tell a followed author from a namesake. Without Zotero nobody is followed, so `names` is empty."""
    if NO_ZOTERO:
        return {name: {"titles": [], "coauthors": set()} for name in names}
    with _ro() as con:
        rows = con.execute("""
            SELECT lower(trim(c.firstName || ' ' || c.lastName)), ic.itemID
            FROM itemCreators ic JOIN creators c USING (creatorID) JOIN creatorTypes ct USING (creatorTypeID)
            WHERE ct.creatorType = 'author' AND ic.itemID NOT IN (SELECT itemID FROM deletedItems)""").fetchall()
        titles = dict(con.execute("""
            SELECT d.itemID, v.value FROM itemData d JOIN fields f USING (fieldID) JOIN itemDataValues v USING (valueID)
            WHERE f.fieldName = 'title'""").fetchall())
    items_by_author: dict[str, list[int]] = defaultdict(list)
    authors_by_item: dict[int, set[str]] = defaultdict(set)
    for name, item in rows:
        items_by_author[name].append(item)
        authors_by_item[item].add(name)
    evidence = {}
    for name in names:
        items = items_by_author[name]
        evidence[name] = {
            "titles": list(dict.fromkeys(titles[i] for i in items if i in titles))[:EVIDENCE_TITLES],
            "coauthors": set().union(*(authors_by_item[i] for i in items)) - {name},
        }
    return evidence


def _zotero_recent_titles() -> list[str]:
    if NO_ZOTERO:
        return []
    with _ro() as con:
        rows = con.execute("""
            SELECT v.value FROM items i
            JOIN itemData d USING (itemID) JOIN fields f USING (fieldID) JOIN itemDataValues v USING (valueID)
            JOIN itemTypes t USING (itemTypeID)
            WHERE f.fieldName = 'title' AND t.typeName NOT IN ('attachment', 'note', 'annotation')
              AND i.itemID NOT IN (SELECT itemID FROM deletedItems)
            ORDER BY i.dateAdded DESC LIMIT ?""", (RECENT_ZOTERO,)).fetchall()
    return [r[0] for r in rows]


def _asked_cards(hub: Hub) -> list[dict]:
    """Cards the user asked about in chat, newest first, with what they asked."""
    asked: dict[str, dict] = {}
    for r in hub.list_chat(CHAT_SCAN, None, None):
        if r["author"] == "me" and r["card_id"] is not None and r["card_id"] not in asked and len(asked) < CARD_SIGNALS:
            card = hub.get_card(r["card_id"])
            asked[r["card_id"]] = {"title": card["title"], "question": r["body"]}
    return list(asked.values())


def light(hub: Hub) -> dict:
    """The main signals only (taste notes + asked-about cards), for non-paper feeds."""
    return {"taste_notes": [n["text"] for n in hub.get_taste()], "cards_asked_about": _asked_cards(hub)}


@dataclass(frozen=True)
class Taste:
    profile: dict                 # what Claude reads
    followed: set[str]            # lower-cased author names for matching
    query_authors: list[str]      # authors that get a direct arXiv query


def build(hub: Hub) -> Taste:
    authors = _zotero_authors()
    saved = hub.list_cards(CARD_SIGNALS, "saved")
    dismissed = hub.list_cards(CARD_SIGNALS, "dismissed")
    projects = hub.list_projects("active")
    profile = {
        **light(hub),
        "projects": [{k: p[k] for k in ("id", "title", "area", "summary")} for p in projects],
        "zotero_recently_added": _zotero_recent_titles(),
        "cards_saved": [c["title"] for c in saved],
        "cards_dismissed": [c["title"] for c in dismissed],
        "followed_authors": [name for name, _ in authors[:PROFILE_AUTHORS]],
    }
    return Taste(
        profile=profile,
        followed={name.lower() for name, _ in authors},
        query_authors=[name for name, _ in authors[:QUERY_AUTHORS]],
    )
