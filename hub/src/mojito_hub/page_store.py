"""Pages (api.md 页面): self-contained HTML documents at a fixed topic path, rewritten in place,
every write kept as a version. Not to be confused with pages.py (the public OAuth pages).

Title, summary and project come from the document itself; links that show a page are signed
(HMAC, 10 minutes) and served under /p/ in a CSP sandbox with no access to the hub."""

import hashlib
import hmac
import re
import time
from dataclasses import dataclass
from html.parser import HTMLParser
from pathlib import Path

from fastapi import HTTPException

from . import config

# 1–4 lowercase segments; `_smoke/…` (deploy smoke only, hidden from GET /pages) needs at least one more.
PATH_PATTERN = re.compile(r"^(?:_smoke(?:/[a-z0-9-]+){1,3}|[a-z0-9-]+(?:/[a-z0-9-]+){0,3})$")
SMOKE_PREFIX = "_smoke/"
# Route suffixes. api.md forbids them as the last segment; any segment is refused here, since
# `x/versions/3` as a page would be unreachable behind GET /pages/x/versions/3.
RESERVED_SEGMENTS = ("versions", "link")
MAX_HTML_BYTES = 1024 * 1024
MAX_SUMMARY_CHARS = 200
LINK_TTL_S = 600
THEMES = ("dark", "light")
LATEST = "latest"
# api.md: no allow-same-origin, so a page's scripts can reach nothing of the hub.
SANDBOX_CSP = "sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox"
BASE_CSS = (Path(__file__).parent / "page_assets" / "base.css").read_text()


def check_path(path: str) -> None:
    if not PATH_PATTERN.match(path):
        raise HTTPException(422, f"page path {path!r} must be 1–4 segments of a-z, 0-9, - separated by /")
    reserved = [s for s in path.split("/") if s in RESERVED_SEGMENTS]
    if reserved:
        raise HTTPException(422, f"page path {path!r} must not contain the segment {reserved[0]!r}")


def is_smoke(path: str) -> bool:
    return path.startswith(SMOKE_PREFIX)


@dataclass
class Parsed:
    title: str
    summary: str
    project_id: str | None
    html_tag_end: int  # offset just after `<html` of the root element's start tag


class _HeadReader(HTMLParser):
    """Collects <title> text and the description / mojito-project metas, and where the <html>
    start tag is. <title> inside <svg> or <math> (accessible names of drawings) is not the page title."""

    def __init__(self, source: str):
        super().__init__(convert_charrefs=True)
        self.line_starts = [0] + [m.end() for m in re.finditer("\n", source)]
        self.titles: list[str] = []
        self.metas: dict[str, list[str | None]] = {"description": [], "mojito-project": []}
        self.html_at: list[int] = []
        self.foreign_depth = 0
        self.in_title = False

    def char_at(self) -> int:
        line, col = self.getpos()
        return self.line_starts[line - 1] + col

    def handle_starttag(self, tag, attrs):
        if tag == "html":
            self.html_at.append(self.char_at())
        elif tag in ("svg", "math"):
            self.foreign_depth += 1
        elif tag == "title" and self.foreign_depth == 0:
            self.in_title = True
            self.titles.append("")
        elif tag == "meta":
            a = dict(attrs)
            if "name" in a and a["name"] in self.metas:
                self.metas[a["name"]].append(a["content"] if "content" in a else None)

    def handle_startendtag(self, tag, attrs):
        if tag in ("html", "meta"):  # `<meta … />`; a self-closing svg/math/title has no content
            self.handle_starttag(tag, attrs)

    def handle_endtag(self, tag):
        if tag in ("svg", "math"):
            self.foreign_depth -= 1
        elif tag == "title":
            self.in_title = False

    def handle_data(self, data):
        if self.in_title:
            self.titles[-1] += data


def parse(html: str) -> Parsed:
    """api.md 页面 格式: <title> and <meta name="description"> required (≤ 200 chars), at most one
    <meta name="mojito-project">, and an <html> element for the theme. Any other shape → 422."""
    reader = _HeadReader(html)
    reader.feed(html)
    reader.close()
    if len(reader.html_at) != 1:
        raise HTTPException(422, f"page html must have exactly one <html> start tag, found {len(reader.html_at)}")
    if len(reader.titles) != 1:
        raise HTTPException(422, f"page html must have exactly one <title>, found {len(reader.titles)}")
    title = " ".join(reader.titles[0].split())
    if not title:
        raise HTTPException(422, "page <title> is empty")
    descriptions = reader.metas["description"]
    if len(descriptions) != 1 or descriptions[0] is None:
        raise HTTPException(422, f'page html must have exactly one <meta name="description" content="…">, '
                                 f"found {len(descriptions)}")
    summary = " ".join(descriptions[0].split())
    if not summary or len(summary) > MAX_SUMMARY_CHARS:
        raise HTTPException(422, f"page description must be 1–{MAX_SUMMARY_CHARS} characters, got {len(summary)}")
    projects = reader.metas["mojito-project"]
    if len(projects) > 1 or (projects and not projects[0]):
        raise HTTPException(422, 'page html may have one <meta name="mojito-project" content="<project_id>">')
    return Parsed(title=title, summary=summary, project_id=projects[0] if projects else None,
                  html_tag_end=reader.html_at[0] + len("<html"))


def themed(html: str, theme: str) -> str:
    """The html with data-theme on the root element, first among its attributes so it wins over
    one the page may carry itself."""
    at = parse(html).html_tag_end
    return f'{html[:at]} data-theme="{theme}"{html[at:]}'


def _sig(path: str, v: str, theme: str, exp: int) -> str:
    return hmac.new(config.PAGES_LINK_KEY, f"{path}\n{v}\n{theme}\n{exp}".encode(), hashlib.sha256).hexdigest()


def link(path: str, version: int | None, theme: str) -> str:
    v = LATEST if version is None else str(version)
    exp = int(time.time()) + LINK_TTL_S
    return f"{config.PUBLIC_URL}/p/{path}?v={v}&theme={theme}&exp={exp}&sig={_sig(path, v, theme, exp)}"


def verify(path: str, v: str, theme: str, exp: str, sig: str) -> int | None:
    """The version a /p/ link shows (None = latest), or 403 when the signature is wrong or expired."""
    if (not re.fullmatch(r"[0-9]{1,12}", exp)
            or not hmac.compare_digest(sig.encode(), _sig(path, v, theme, int(exp)).encode())):
        raise HTTPException(403, "bad link signature")
    if int(exp) < time.time():
        raise HTTPException(403, "link expired")
    return None if v == LATEST else int(v)
