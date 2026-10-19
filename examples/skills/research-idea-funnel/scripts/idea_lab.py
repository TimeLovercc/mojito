#!/usr/bin/env python3
# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Explicit, recoverable Idea Lab synchronization for ordinary research sessions (docs/api.md, Idea Lab).

Usage and recovery: ../references/idea-lab.md. Credentials: $MOJITO_SECRETS_DIR/idea-lab.env (mode 600) with
MOJITO_HUB_URL and MOJITO_IDEA_LAB_TOKEN, a source:ideas token (hub/deploy/mac-env.sh writes it).
"""
import argparse
from contextlib import contextmanager
from datetime import datetime
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import sys
import tempfile
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener
from uuid import uuid4

FIELDS = (
    "title", "question", "importance", "status", "seed_ids", "hypotheses", "evidence",
    "changes", "next_step", "artifacts", "notion_url", "notion_sync",
)
STATES = {"developing", "ready", "experimenting", "supported", "contradicted", "archived"}


class SyncError(Exception):
    pass


class ApiError(SyncError):
    def __init__(self, status, detail):
        self.status = status
        self.detail = detail
        super().__init__(f"HTTP {status}: {detail}")


def require(condition, message):
    if not condition:
        raise SyncError(message)


def exact_keys(value, keys, where):
    require(type(value) is dict and set(value) == set(keys), f"{where}: required keys are {list(keys)}")


def timestamp(value):
    require(type(value) is str, "timestamp must be a string")
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    require(parsed.tzinfo is not None, f"timestamp requires timezone: {value!r}")
    return parsed


def validate_content(data):
    exact_keys(data, FIELDS, "IdeaInput")
    for key in ("title", "question", "importance", "status", "next_step", "notion_sync"):
        require(type(data[key]) is str, f"{key} must be a string")
    require(1 <= len(data["title"]) <= 200 and len(data["question"]) >= 1, "title/question length invalid")
    require(data["status"] in STATES, f"invalid status: {data['status']!r}")
    for key in ("seed_ids", "hypotheses", "evidence", "changes", "artifacts"):
        require(type(data[key]) is list, f"{key} must be a list")
    for key in ("seed_ids", "hypotheses"):
        require(all(type(value) is str for value in data[key]), f"{key} must contain strings")
    for item in data["evidence"]:
        exact_keys(item, ("id", "claim", "source", "kind", "at"), "evidence")
        require(all(type(value) is str for value in item.values()), "evidence values must be strings")
        require(item["kind"] in {"observation", "literature", "experiment", "review"}, "invalid evidence kind")
        timestamp(item["at"])
    ids = [item["id"] for item in data["evidence"]]
    require(len(ids) == len(set(ids)), f"duplicate evidence ids: {ids!r}")
    for item in data["changes"]:
        exact_keys(item, ("at", "before", "after", "reason"), "change")
        require(all(type(value) is str for value in item.values()), "change values must be strings")
        timestamp(item["at"])
    for item in data["artifacts"]:
        exact_keys(item, ("kind", "title", "url"), "artifact")
        require(all(type(value) is str for value in item.values()), "artifact values must be strings")
        require(item["kind"] in {"source", "experiment", "paper", "review", "notion"}, "invalid artifact kind")
    require(data["notion_url"] is None or type(data["notion_url"]) is str, "notion_url must be string or null")
    require(data["notion_sync"] in {"pending", "synced"}, "invalid notion_sync")
    if data["notion_sync"] == "synced":
        require(type(data["notion_url"]) is str and data["notion_url"].startswith("https://"),
                "synced requires a verified Notion HTTPS URL")
    return data


def content_of(idea):
    return validate_content({key: idea[key] for key in FIELDS})


def normalized(content):
    result = json.loads(json.dumps(content))
    for key in ("evidence", "changes"):
        for item in result[key]:
            item["at"] = timestamp(item["at"]).timestamp()
    return result


def same_content(left, right):
    return normalized(left) == normalized(right)


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()).hexdigest()


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


def atomic_write(path, value):
    with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent, prefix=".idea-lab-", delete=False) as handle:
        temporary = Path(handle.name)
        json.dump(value, handle, ensure_ascii=False, indent=2)
        handle.write("\n")
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(temporary, path)
    directory = os.open(path.parent, os.O_RDONLY)
    try:
        os.fsync(directory)
    finally:
        os.close(directory)


@contextmanager
def locked(path):
    path.parent.mkdir(parents=True, exist_ok=True)
    lock_path = path.with_name(path.name + ".lock")
    with lock_path.open("a") as handle:
        os.chmod(lock_path, 0o600)
        try:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise SyncError(f"bundle is locked by another process: {path}") from error
        yield


def credentials(path):
    info = path.lstat()
    require(stat.S_ISREG(info.st_mode) and stat.S_IMODE(info.st_mode) == 0o600 and info.st_uid == os.getuid(),
            f"credential file must be owned by current user, regular and mode 600: {path}")
    fields = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        require("=" in line, f"invalid credential assignment in {path}")
        key, value = line.split("=", 1)
        key, value = key.strip(), value.strip()
        require(key in {"MOJITO_HUB_URL", "MOJITO_IDEA_LAB_TOKEN"} and key not in fields,
                f"unexpected or duplicate credential key in {path}")
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        fields[key] = value
    exact_keys(fields, ("MOJITO_HUB_URL", "MOJITO_IDEA_LAB_TOKEN"), str(path))
    parts = urlsplit(fields["MOJITO_HUB_URL"])
    require(parts.scheme == "https" or (parts.scheme == "http" and parts.hostname in {"127.0.0.1", "localhost", "::1"}),
            "hub endpoint must use HTTPS (HTTP only for loopback checks)")
    require(parts.hostname is not None and parts.username is None and parts.password is None and
            parts.path in {"", "/"} and not parts.query and not parts.fragment, "hub endpoint must be an origin without credentials/path/query")
    require(re.fullmatch(r"[A-Za-z0-9_-]{32,}", fields["MOJITO_IDEA_LAB_TOKEN"]) is not None,
            f"invalid dedicated token format in {path}")
    origin = f"{parts.scheme}://{parts.netloc.lower()}"
    return origin, fields["MOJITO_IDEA_LAB_TOKEN"]


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise SyncError(f"hub redirect refused (HTTP {code}); check configured origin")


class Client:
    def __init__(self, config_path):
        self.origin, self.token = credentials(config_path)
        self.opener = build_opener(NoRedirect())

    def request(self, method, path, body):
        encoded = None if body is None else json.dumps(body, ensure_ascii=False).encode()
        request = Request(self.origin + path, data=encoded, method=method,
                          headers={"Authorization": "Bearer " + self.token, "Content-Type": "application/json"})
        try:
            with self.opener.open(request, timeout=30) as response:
                return json.load(response)
        except HTTPError as error:
            detail = error.read().decode("utf-8", errors="replace").replace(self.token, "[redacted]")
            raise ApiError(error.code, detail) from None
        except (URLError, TimeoutError) as error:
            raise SyncError(f"network request failed ({type(error).__name__}); pending request retained, use retry") from None

    def idea(self, idea_id):
        return self.request("GET", "/idea-lab/ideas/" + quote(idea_id, safe=""), None)


def bundle(origin, base, payload, state):
    return {"version": 1, "endpoint": origin, "base": base, "payload": payload, "state": state,
            "operation": None, "remote": None, "history": [], "error": None}


def base_of(idea):
    require(type(idea["id"]) is str and type(idea["revision"]) is int and idea["revision"] >= 1,
            "invalid idea id/revision returned by hub")
    return {"id": idea["id"], "revision": idea["revision"], "content": content_of(idea)}


def load_bundle(path, client):
    data = read_json(path)
    require(data["version"] == 1, f"unsupported bundle version: {data['version']!r}")
    require(data["endpoint"] == client.origin, "bundle endpoint differs from credential endpoint; refusing replay")
    validate_content(data["payload"])
    if data["operation"] is not None:
        op = data["operation"]
        require(digest(op["request"]) == op["request_sha256"], "pending operation was edited; restore its original persisted request")
        require(same_content(data["payload"], op["request"]["content"]), "bundle payload changed outside CLI; use explicit rebase after resolving pending sync")
    return data


def report(path, data):
    base = None if data["base"] is None else {key: data["base"][key] for key in ("id", "revision")}
    print(json.dumps({"bundle": str(path), "state": data["state"], "base": base,
                      "operation_id": None if data["operation"] is None else data["operation"]["request"]["operation_id"],
                      "remote_revision": None if data["remote"] is None else data["remote"]["revision"],
                      "error": data["error"]}, ensure_ascii=False, indent=2))


def verify_receipt(path, data, client):
    op = data["operation"]
    receipt = op["receipt"]
    saved = receipt["idea"]
    request = op["request"]
    require(receipt["operation_id"] == request["operation_id"], "receipt operation_id mismatch; receipt retained")
    require(same_content(content_of(saved), request["content"]), "receipt content differs from pending request; receipt retained")
    if request["existing_id"] is not None:
        require(saved["id"] == request["existing_id"] and saved["revision"] == request["revision"] + 1,
                "receipt identity/revision differs from update request; receipt retained")
    else:
        require(saved["revision"] == 1, "create receipt revision must be 1; receipt retained")
    current = client.idea(saved["id"])
    require(current["id"] == saved["id"], "verification GET returned a different idea identity; receipt retained")
    content_of(current)
    data["remote"] = current
    if current["revision"] > saved["revision"]:
        data["state"] = "current_newer"
        data["error"] = "Sync receipt retained, but current server revision is newer. Inspect local/remote and explicitly rebase a merged input."
    elif current["revision"] == saved["revision"] and same_content(content_of(current), content_of(saved)):
        data["base"] = base_of(current)
        data["state"] = "synced"
        data["error"] = None
    else:
        data["state"] = "verification_failed"
        data["error"] = "Current server idea does not match the persisted receipt; no overwrite performed."
    atomic_write(path, data)
    report(path, data)
    return 0 if data["state"] == "synced" else 3


def transmit(path, data, client):
    op = data["operation"]
    if op["receipt"] is None:
        try:
            receipt = client.request("GET", "/idea-lab/sync/" + quote(op["request"]["operation_id"], safe=""), None)
        except ApiError as error:
            if error.status != 404:
                raise
            try:
                receipt = client.request("POST", "/idea-lab/sync", op["request"])
            except ApiError as post_error:
                data["error"] = str(post_error)
                if post_error.status == 409:
                    data["state"] = "conflict"
                elif post_error.status in {404, 422}:
                    data["state"] = "rejected"
                atomic_write(path, data)
                if post_error.status == 409 and op["request"]["existing_id"] is not None:
                    data["remote"] = client.idea(op["request"]["existing_id"])
                    atomic_write(path, data)
                raise
        op["receipt"] = receipt
        atomic_write(path, data)  # persist acknowledgement before the verification GET
    return verify_receipt(path, data, client)


def push(path, data, client, input_path):
    incoming = data["payload"] if input_path is None else validate_content(read_json(input_path))
    if not same_content(incoming, data["payload"]):
        require(data["operation"] is None or data["state"] in {"synced", "rejected"},
                "pending/conflicted input cannot change; retry first, or explicitly rebase merged content")
        if data["operation"] is not None:
            data["history"].append(data["operation"])
        data["operation"] = None
        data["payload"] = incoming
        data["state"] = "draft"
    if data["operation"] is None:
        request = {"operation_id": str(uuid4()),
                   "existing_id": None if data["base"] is None else data["base"]["id"],
                   "revision": None if data["base"] is None else data["base"]["revision"],
                   "content": data["payload"]}
        data["operation"] = {"request": request, "request_sha256": digest(request), "receipt": None}
        data["state"] = "pending"
        data["remote"] = None
        data["error"] = None
        atomic_write(path, data)  # durable operation identity before the first network request
    return transmit(path, data, client)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=lambda value: Path(value).expanduser().resolve(),
                        help="explicit dedicated idea-lab.env; otherwise $MOJITO_SECRETS_DIR/idea-lab.env")
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("list")
    get = commands.add_parser("get"); get.add_argument("idea_id")
    for name in ("new", "pull", "push", "retry", "status", "rebase"):
        command = commands.add_parser(name)
        command.add_argument("bundle", type=lambda value: Path(value).expanduser().resolve())
        if name in {"new", "push", "rebase"}:
            command.add_argument("--input", type=lambda value: Path(value).expanduser().resolve(), required=name != "push")
        if name == "pull":
            command.add_argument("--id", required=True)
        if name == "rebase":
            command.add_argument("--revision", type=int, required=True)
    args = parser.parse_args()
    config_path = Path(os.environ["MOJITO_SECRETS_DIR"]).expanduser() / "idea-lab.env" if args.config is None else args.config
    if args.command in {"list", "get"}:
        client = Client(config_path)
        result = client.request("GET", "/idea-lab", None) if args.command == "list" else client.idea(args.idea_id)
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0
    path = args.bundle
    with locked(path):
        if args.command == "status":
            report(path, read_json(path))
            return 0
        client = Client(config_path)
        if args.command in {"new", "pull"}:
            require(not path.exists(), f"bundle already exists: {path}")
            if args.command == "new":
                data = bundle(client.origin, None, validate_content(read_json(args.input)), "draft")
            else:
                idea = client.idea(args.id)
                data = bundle(client.origin, base_of(idea), content_of(idea), "draft")
            atomic_write(path, data)
            report(path, data)
            return 0
        data = load_bundle(path, client)
        if args.command == "push":
            return push(path, data, client, args.input)
        if args.command == "retry":
            require(data["operation"] is not None, "no pending operation; use push")
            return transmit(path, data, client)
        require(data["state"] in {"conflict", "current_newer"}, "rebase requires a recorded conflict or newer remote revision")
        if data["remote"] is not None:
            idea_id = data["remote"]["id"]
        else:
            idea_id = data["operation"]["request"]["existing_id"]
        require(idea_id is not None, "create operation conflict has no safe remote identity; inspect receipt before creating another bundle")
        current = client.idea(idea_id)
        data["remote"] = current
        atomic_write(path, data)
        require(current["revision"] == args.revision, f"remote changed again: current revision={current['revision']}; inspect and merge it first")
        merged = validate_content(read_json(args.input))
        data["history"].append(data["operation"])
        data["operation"] = None
        data["base"] = base_of(current)
        data["payload"] = merged
        data["state"] = "draft"
        data["error"] = None
        atomic_write(path, data)
        report(path, data)
        return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (SyncError, OSError, ValueError, KeyError) as error:
        print(f"idea-lab: {error}", file=sys.stderr)
        sys.exit(2)
