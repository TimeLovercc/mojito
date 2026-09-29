import os
from dataclasses import dataclass

REQUIRED_ENV = ("MOJITO_HUB_URL", "MOJITO_AGENT_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN", "MOJITO_CLAUDE_BIN", "MOJITO_GOOGLE_OAUTH",
                "MOJITO_TIMEZONE")
SOURCE_NAME = "server-agent"
# IANA zone of the owner, the same value as the hub's MOJITO_TIMEZONE (read at import: prompts and dates use it).
TIMEZONE = os.environ["MOJITO_TIMEZONE"]
POLL_INTERVAL_S = 10
HEARTBEAT_INTERVAL_S = 300
# Must stay below HEARTBEAT_INTERVAL_S: one job runs between two heartbeats.
CLAUDE_TIMEOUT_S = 240
HTTP_TIMEOUT_S = 30
AUTH_CHECK_INTERVAL_S = 3600


@dataclass(frozen=True)
class Config:
    hub_url: str
    agent_token: str
    claude_bin: str
    google_oauth: str


def load_config() -> Config:
    """All config comes from the environment (systemd EnvironmentFile on the server).

    CLAUDE_CODE_OAUTH_TOKEN is not read here; it is only checked and then inherited by `claude -p`.
    """
    missing = [k for k in REQUIRED_ENV if not os.environ.get(k)]
    if missing:
        raise SystemExit(f"missing env {missing}")
    return Config(
        hub_url=os.environ["MOJITO_HUB_URL"].rstrip("/"),
        agent_token=os.environ["MOJITO_AGENT_TOKEN"],
        claude_bin=os.environ["MOJITO_CLAUDE_BIN"],
        google_oauth=os.environ["MOJITO_GOOGLE_OAUTH"],
    )
