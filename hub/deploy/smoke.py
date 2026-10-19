"""Post-deploy smoke check (docs/api.md, 部署冒烟检查). Runs on server as root with the
system python3 (stdlib only), after mojito-hub and mojito-agent are up:
    python3 /opt/mojito/hub/deploy/smoke.py /path/to/tokens.json
Walks the core loop against http://127.0.0.1:8787 with a real app token, using
smoke=true records so nothing is pushed, processed or counted; then writes the page
_smoke/page with the source:pages token and opens its signed link (api.md 页面), and
writes and deletes a fresh _smoke/delete-<time> page (api.md 删除页面).
Any failure prints the step, HTTP status and detail (never the token) and exits 1."""
import json
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime
from email.message import Message
from urllib.parse import urlsplit

HUB = "http://127.0.0.1:8787"
REPLY_TIMEOUT_S = 180
SMOKE_PAGE = "_smoke/page"
PAGE_CSP = "sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox"
PAGE_HTML = """<!doctype html>
<html lang="zh"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>部署检查</title><meta name="description" content="部署冒烟写入的页面，不出现在页面列表里">
<link rel="stylesheet" href="/pages-assets/base.css"></head>
<body><h1>部署检查</h1><p class="meta"><time>{stamp}</time></p></body></html>
"""


class StepFailed(Exception):
    pass


def parse_at(at: str) -> datetime:
    # The hub writes UTC as "...Z"; server's python3 (3.10) fromisoformat doesn't accept "Z".
    return datetime.fromisoformat(at.replace("Z", "+00:00"))


def call(token: str, method: str, path: str, body: dict | None = None) -> dict:
    req = urllib.request.Request(HUB + path, method=method,
                                 data=None if body is None else json.dumps(body).encode(),
                                 headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.load(resp)
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            detail = json.loads(raw)["detail"]
        except (ValueError, KeyError):
            detail = raw[:500]
        raise StepFailed(f"{method} {path} -> {e.code}: {detail}")


def fetch(method: str, path: str, token: str | None, body: dict | None) -> tuple[int, Message, bytes]:
    """A request that does not raise on an HTTP error status: (status, headers (case-insensitive), body)."""
    headers = {} if token is None else {"Authorization": "Bearer " + token}
    if body is not None:
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(HUB + path, method=method, headers=headers,
                                 data=None if body is None else json.dumps(body).encode())
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return resp.status, resp.headers, resp.read()
    except urllib.error.HTTPError as e:
        return e.code, e.headers, e.read()


def check(ok: bool, what: str) -> None:
    if not ok:
        raise StepFailed(what)


def main() -> None:
    with open(sys.argv[1]) as f:
        tokens = json.load(f)
    app = next(t for t, role in tokens.items() if role == "app")
    pages_tokens = [t for t, role in tokens.items() if role == "source:pages"]
    if not pages_tokens:
        sys.exit("smoke FAILED: no source:pages token in tokens.json (run gen-tokens.sh)")
    pages = pages_tokens[0]
    stamp = datetime.now().astimezone().isoformat(timespec="seconds")
    passed: list[str] = []
    state: dict = {}

    def note():
        rec = call(app, "POST", "/records", {
            "title": "部署检查", "body": f"部署检查 {stamp}", "item_id": None, "project_id": None,
            "needs_processing": True, "attachment_ids": [], "smoke": True})
        check(rec["smoke"] is True, f"POST /records returned smoke={rec['smoke']}")
        state["note"] = rec
        return f"POST /records -> 2xx, record {rec['id']} smoke=true"

    def chat():
        out = call(app, "POST", "/chat", {
            "body": "部署检查：请只回复\"收到\"", "item_id": None, "project_id": None, "card_id": None,
            "attachment_ids": [], "smoke": True})
        msg, job = out["record"], out["job"]
        state["chat"] = msg
        t0 = time.monotonic()
        while job["status"] not in ("done", "failed"):
            check(time.monotonic() - t0 < REPLY_TIMEOUT_S,
                  f"job {job['id']} still {job['status']} after {REPLY_TIMEOUT_S}s")
            time.sleep(2)
            job = call(app, "GET", f"/jobs/{job['id']}")
        check(job["status"] == "done", f"job {job['id']} failed: {job['error']}")
        waited = time.monotonic() - t0
        sent_at = parse_at(msg["at"])
        records = call(app, "GET", "/chat?limit=10&include_smoke=true")["records"]
        replies = [r for r in records if r["source"] == "server-agent" and r["smoke"] is True
                   and parse_at(r["at"]) > sent_at]
        check(len(replies) > 0, f"no smoke reply from server-agent after {msg['at']} in GET /chat?include_smoke=true")
        state["reply"] = replies[0]
        return (f"POST /chat -> 2xx, job {job['id']} done in {waited:.0f}s, "
                f"server-agent reply {replies[0]['id']} at {replies[0]['at']}: {replies[0]['body'][:40]!r}")

    def today():
        call(app, "GET", "/today")
        return "GET /today -> 2xx"

    def cards():
        call(app, "GET", "/cards?limit=20")
        return "GET /cards?limit=20 -> 2xx"

    def hidden():
        smoke_ids = {state["note"]["id"], state["chat"]["id"], state["reply"]["id"]}
        leaked = smoke_ids & {r["id"] for r in call(app, "GET", "/records?limit=50")["records"]}
        check(not leaked, f"smoke records visible in GET /records: {sorted(leaked)}")
        leaked = smoke_ids & {r["id"] for r in call(app, "GET", "/chat?limit=20")["records"]}
        check(not leaked, f"smoke records visible in GET /chat: {sorted(leaked)}")
        jobs = [j for j in call(app, "GET", "/jobs")["jobs"]
                if j["kind"] == "process_note" and j["record_id"] == state["note"]["id"]]
        check(not jobs, f"smoke note {state['note']['id']} queued process_note job(s): {[j['id'] for j in jobs]}")
        return "smoke records absent from GET /records and GET /chat; no process_note job for the smoke note"

    def page_write():
        status, _, raw = fetch("GET", "/pages/" + SMOKE_PAGE, pages, None)
        check(status in (200, 404), f"GET /pages/{SMOKE_PAGE} -> {status}: {raw[:300]!r}")
        base = 0 if status == 404 else json.loads(raw)["version"]
        html = PAGE_HTML.format(stamp=stamp)
        meta = call(pages, "PUT", "/pages/" + SMOKE_PAGE,
                    {"html": html, "base_version": base, "note": f"部署检查 {stamp}", "by": None})
        check(meta["version"] == base + 1, f"PUT /pages/{SMOKE_PAGE} on base {base} returned version {meta['version']}")
        page = call(pages, "GET", "/pages/" + SMOKE_PAGE)
        check(page["version"] == meta["version"] and page["html"] == html,
              f"GET /pages/{SMOKE_PAGE} returned version {page['version']}, html equal: {page['html'] == html}")
        return f"PUT /pages/{SMOKE_PAGE} base {base} -> version {meta['version']}, GET reads the same html back"

    def page_link():
        url = call(pages, "POST", f"/pages/{SMOKE_PAGE}/link", {"theme": "dark", "version": None})["url"]
        parts = urlsplit(url)
        status, headers, raw = fetch("GET", f"{parts.path}?{parts.query}", None, None)
        check(status == 200, f"GET {parts.path} (signed link) -> {status}: {raw[:300]!r}")
        check(headers["Content-Security-Policy"] == PAGE_CSP,
              f"GET {parts.path}: Content-Security-Policy is {headers['Content-Security-Policy']!r}")
        check(headers["Cache-Control"] == "no-store", f"GET {parts.path}: Cache-Control is {headers['Cache-Control']!r}")
        check(b'data-theme="dark"' in raw, f"GET {parts.path}: no data-theme=\"dark\" on <html>")
        status, headers, _ = fetch("GET", "/pages-assets/base.css", None, None)
        check(status == 200 and headers["Content-Type"].startswith("text/css"),
              f"GET /pages-assets/base.css -> {status} {headers['Content-Type']}")
        return f"POST link -> {parts.scheme}://{parts.netloc}{parts.path}, GET it -> 200 with sandbox CSP; base.css 200"

    def page_hidden():
        leaked = [p["path"] for p in call(pages, "GET", "/pages")["pages"] if p["path"].startswith("_smoke/")]
        check(not leaked, f"smoke pages visible in GET /pages: {leaked}")
        return "no _smoke/ page in GET /pages"

    def page_delete():
        path = "_smoke/delete-" + datetime.now().strftime("%Y%m%d-%H%M%S")
        html = PAGE_HTML.format(stamp=stamp)
        call(pages, "PUT", "/pages/" + path, {"html": html, "base_version": 0, "note": f"部署检查 {stamp}", "by": None})
        link = urlsplit(call(pages, "POST", f"/pages/{path}/link", {"theme": "light", "version": None})["url"])
        meta = call(pages, "DELETE", "/pages/" + path, {"base_version": 1, "note": f"部署检查 {stamp}", "by": None})
        check(meta["version"] == 1 and meta["deleted_at"] is not None and meta["delete_note"] == f"部署检查 {stamp}",
              f"DELETE /pages/{path} returned version {meta['version']}, deleted_at {meta['deleted_at']}, "
              f"delete_note {meta['delete_note']!r}")
        for method, url, token in (("GET", "/pages/" + path, pages), ("GET", f"/pages/{path}/versions", pages),
                                   ("GET", f"{link.path}?{link.query}", None)):
            status, _, raw = fetch(method, url, token, None)
            check(status == 404, f"{method} {url.split('?')[0]} after delete -> {status}: {raw[:300]!r}")
        listed = [p["path"] for p in call(pages, "GET", "/pages")["pages"] if p["path"] == path]
        check(not listed, f"deleted page {path} still in GET /pages")
        status, _, raw = fetch("PUT", "/pages/" + path, pages,
                               {"html": html, "base_version": 1, "note": f"部署检查 {stamp}", "by": None})
        detail = json.loads(raw)["detail"] if status == 409 else None
        check(status == 409 and "已删除" in detail["message"] and detail["version"] == 1,
              f"PUT /pages/{path} after delete -> {status}: {raw[:300].decode(errors='replace')}")
        return (f"PUT {path} base 0 -> v1, DELETE base 1 -> deleted; GET, versions and its signed link -> 404; "
                "absent from GET /pages; PUT again -> 409 已删除")

    steps = [("1 一行笔记", note), ("2 对话 + 服务器 agent 回复", chat), ("3 今天页", today),
             ("4 信息流", cards), ("5 没有漏出去", hidden), ("6 页面写入读回", page_write),
             ("7 页面签名链接", page_link), ("8 冒烟页面不在列表里", page_hidden), ("9 页面删除", page_delete)]
    for name, step in steps:
        try:
            result = step()
        except StepFailed as e:
            print(f"smoke FAILED at step {name}: {e}", file=sys.stderr)
            sys.exit(1)
        print(f"smoke ok: {name}: {result}")
        passed.append(f"  {name}: {result}")
    print("smoke passed:")
    print("\n".join(passed))


main()
