"""Bearer tokens → roles. Unknown token 401, wrong role 403."""

from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from . import config

bearer = HTTPBearer(auto_error=False)


async def role(creds: HTTPAuthorizationCredentials | None = Depends(bearer)) -> str:
    if creds is None or creds.credentials not in config.TOKENS:
        raise HTTPException(401, "unknown token")
    return config.TOKENS[creds.credentials]


async def app_token_ref(creds: HTTPAuthorizationCredentials | None = Depends(bearer),
                        r: str = Depends(role)) -> str:
    """token_ref of the calling app token (web push subscriptions remember it, not the token)."""
    if r != "app":
        raise HTTPException(403, f"role {r} not allowed")
    return config.token_ref(creds.credentials)


def allow(*roles: str):
    async def check(r: str = Depends(role)) -> str:
        if r not in roles:
            raise HTTPException(403, f"role {r} not allowed")
        return r
    return check


# GETs of the app group; maintainer (feedback triage) reads everything the app can.
app_read = allow("app", "worker", "agent", "maintainer")
app_write = allow("app")
worker = allow("worker")
app_get = allow("app", "maintainer")
app_or_agent = allow("app", "agent")
settings_readers = allow("app", "agent", "worker", "maintainer")
settings_writers = allow("app", "agent", "worker")
project_creators = allow("app", "agent", "worker")
# Task-type data sources the worker reports for (heartbeat + health), besides `worker` itself.
WORKER_TASK_SOURCES = ("feed-papers", "sync-projects")
maintainer = allow("maintainer")
runners = allow("worker", "agent")
item_writers = allow("worker", "agent")
agent = allow("agent")
plan_writers = allow("worker", "agent")
card_writers = allow("worker", "source:cards")
app_or_runners = allow("app", "agent", "worker")
uploaders = allow("app", "worker")
subscription_togglers = allow("app", "agent", "worker")
subscription_runners = allow("app", "agent", "worker")
feedback_talkers = allow("app", "maintainer", "agent")


def actor(r: str) -> tuple[str, str]:
    """(author, source) of a record describing a change made with role `r`."""
    return ("me", "app") if r == "app" else ("system", SOURCE_OF[r])

SOURCE_OF = {"worker": "worker", "agent": "server-agent"}
# Which runner reports which authorization (api.md 授权状态).
AUTH_REPORTER = {"google-calendar-write": "agent", "claude-server": "agent",
                 "gmail-read": "worker", "claude-mac": "worker"}
RUNNER_OF = {"worker": "mac", "agent": "server"}


def may_report_for(r: str, src: str, name: str) -> bool:
    """Heartbeat/health for source `name`: its own token, or the worker for its task sources."""
    return name == src or (r == "worker" and name in WORKER_TASK_SOURCES)


async def heartbeat_source(r: str = Depends(role)) -> str:
    """Heartbeats also come from the maintainer session (source `maintainer`)."""
    if r == "maintainer":
        return "maintainer"
    return await source(r)


async def source(r: str = Depends(role)) -> str:
    """Source name for data-source endpoints: `source:<name>` → name, worker → `worker`,
    agent → `server-agent`."""
    if r in SOURCE_OF:
        return SOURCE_OF[r]
    if r.startswith("source:"):
        return r.removeprefix("source:")
    raise HTTPException(403, f"role {r} not allowed")
