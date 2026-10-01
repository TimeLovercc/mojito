"""Post-deploy smoke check (docs/api.md, 部署冒烟检查). Runs on server as root with the
system python3 (stdlib only), after mojito-hub and mojito-agent are up:
    python3 /opt/mojito/hub/deploy/smoke.py /path/to/tokens.json
Walks the core loop against http://127.0.0.1:8787 with a real app token, using
smoke=true records so nothing is pushed, processed or counted. Any failure prints the
step, HTTP status and detail (never the token) and exits 1."""
import json
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime

HUB = "http://127.0.0.1:8787"
REPLY_TIMEOUT_S = 180


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


def check(ok: bool, what: str) -> None:
    if not ok:
        raise StepFailed(what)


def main() -> None:
    with open(sys.argv[1]) as f:
        tokens = json.load(f)
    app = next(t for t, role in tokens.items() if role == "app")
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

    steps = [("1 一行笔记", note), ("2 对话 + 服务器 agent 回复", chat), ("3 今天页", today),
             ("4 信息流", cards), ("5 没有漏出去", hidden)]
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
