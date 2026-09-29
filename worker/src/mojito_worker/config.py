"""Worker configuration. Everything that differs between machines comes from the environment or
worker/.env (see worker/.env.example); a missing variable fails at import with its name."""
import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

ENV_FILE = Path(__file__).resolve().parents[2] / ".env"
load_dotenv(ENV_FILE)  # the process environment wins over the file

# Absolute path of the `claude` executable (`command -v claude`).
CLAUDE_BIN = os.environ["MOJITO_CLAUDE_BIN"]
# IANA zone of the owner, the same value as the hub's MOJITO_TIMEZONE.
TIMEZONE = os.environ["MOJITO_TIMEZONE"]
# Local facts the worker may read (read-only): git repos under this root.
PROJECTS_ROOT = Path(os.environ["MOJITO_PROJECTS_ROOT"]).expanduser()
# Gmail read-only: google-auth authorized-user JSON with only gmail.readonly (stays on this machine).
GOOGLE_OAUTH_FILE = Path(os.environ["MOJITO_GMAIL_OAUTH_FILE"]).expanduser()
# Zotero library for the paper feed's taste signals: path to zotero.sqlite, or the word `none` to go without.
ZOTERO_DB = os.environ["MOJITO_ZOTERO_DB"]
# arXiv categories of the daily paper feed, comma-separated (e.g. cs.AI,cs.HC).
ARXIV_CATEGORIES = tuple(c.strip() for c in os.environ["MOJITO_ARXIV_CATEGORIES"].split(","))
ORCA_BIN = "orca"
POLL_INTERVAL_S = 15
HEARTBEAT_INTERVAL_S = 86400
CLAUDE_TIMEOUT_S = 600
HTTP_TIMEOUT_S = 30

if not Path(CLAUDE_BIN).is_file():
    raise FileNotFoundError(f"MOJITO_CLAUDE_BIN {CLAUDE_BIN} is not a file")
if not PROJECTS_ROOT.is_dir():
    raise FileNotFoundError(f"MOJITO_PROJECTS_ROOT {PROJECTS_ROOT} is not a directory")
if ZOTERO_DB != "none" and not Path(ZOTERO_DB).expanduser().is_file():
    raise FileNotFoundError(f"MOJITO_ZOTERO_DB {ZOTERO_DB} is neither `none` nor a file")
if not all(ARXIV_CATEGORIES):
    raise ValueError(f"MOJITO_ARXIV_CATEGORIES {os.environ['MOJITO_ARXIV_CATEGORIES']!r} has an empty category")


@dataclass(frozen=True)
class Config:
    hub_url: str
    worker_token: str


def load_config() -> Config:
    missing = [k for k in ("MOJITO_HUB_URL", "MOJITO_WORKER_TOKEN") if not os.environ.get(k)]
    if missing:
        raise SystemExit(f"missing env {missing} (expected in environment or {ENV_FILE})")
    return Config(
        hub_url=os.environ["MOJITO_HUB_URL"].rstrip("/"),
        worker_token=os.environ["MOJITO_WORKER_TOKEN"],
    )
