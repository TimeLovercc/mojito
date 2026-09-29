"""Runtime configuration. Every variable is required; a missing or malformed one fails at
import (so deploy.sh can pre-check with `python -c "import mojito_hub.config"`)."""

import base64
import hashlib
import json
import os
import re
from pathlib import Path
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from py_vapid import Vapid02

DB_PATH = os.environ["MOJITO_DB"]
TOKENS_PATH = os.environ["MOJITO_TOKENS"]
SEED_PATH = os.environ["MOJITO_SEED"]
ICAL_URL = os.environ["MOJITO_ICAL_URL"]
FCM_CREDENTIALS = os.environ["MOJITO_FCM_CREDENTIALS"]
ATTACHMENTS_DIR = os.environ["MOJITO_ATTACHMENTS_DIR"]
VAPID_KEY_FILE = os.environ["MOJITO_VAPID_KEY_FILE"]
VAPID_SUBJECT = os.environ["MOJITO_VAPID_SUBJECT"]
PUBLIC_URL = os.environ["MOJITO_PUBLIC_URL"]
WEB_DIR = os.environ["MOJITO_WEB_DIR"]
# IANA zone of the owner (e.g. Europe/Berlin): day boundaries, daily schedules and short times use it.
TIMEZONE = os.environ["MOJITO_TIMEZONE"]
# Shown on the public pages / and /privacy (needed when publishing a Google OAuth client). No spaces:
# deploy.sh splits the env file into arguments for its preflight.
OWNER_NAME = os.environ["MOJITO_OWNER_NAME"]
CONTACT_EMAIL = os.environ["MOJITO_CONTACT_EMAIL"]

ROLE_PATTERN = re.compile(r"^(app|worker|agent|maintainer|source:[A-Za-z0-9_.:-]+)$")
TOKEN_PATTERN = re.compile(r"^[A-Za-z0-9_-]{32,}$")


def load_tokens(path: str) -> dict[str, str]:
    with open(path) as f:
        tokens = json.load(f)
    for token, role in tokens.items():
        if not TOKEN_PATTERN.match(token):
            raise ValueError(f"MOJITO_TOKENS {path}: token ending ...{token[-4:]} must be ≥32 chars of A-Za-z0-9_-")
        if not ROLE_PATTERN.match(role):
            raise ValueError(f"MOJITO_TOKENS {path}: invalid role {role!r} for token ending ...{token[-4:]}")
    return tokens


def token_ref(token: str) -> str:
    """What the hub stores instead of a token (web push subscriptions)."""
    return hashlib.sha256(token.encode()).hexdigest()[:16]


def _check_public_url(url: str) -> str:
    parts = urlsplit(url)
    if parts.scheme != "https" or not parts.netloc or parts.path or parts.query or parts.fragment:
        raise ValueError(f"MOJITO_PUBLIC_URL {url!r} must be https://<host> without path or trailing slash")
    return url


def _load_vapid(path: str) -> tuple[Vapid02, str]:
    # Not Vapid02.from_file: it silently generates and writes a new key when the file is missing.
    if not Path(path).is_file():
        raise FileNotFoundError(f"MOJITO_VAPID_KEY_FILE {path} is not a file")
    vapid = Vapid02.from_pem(Path(path).read_bytes())
    if not isinstance(vapid.private_key.curve, ec.SECP256R1):
        raise ValueError(f"MOJITO_VAPID_KEY_FILE {path}: key must be P-256, not {vapid.private_key.curve.name}")
    point = vapid.public_key.public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
    return vapid, base64.urlsafe_b64encode(point).rstrip(b"=").decode()


TOKENS = load_tokens(TOKENS_PATH)
APP_TOKEN_REFS = {token_ref(t) for t, role in TOKENS.items() if role == "app"}

if not VAPID_SUBJECT.startswith(("mailto:", "https://")):
    raise ValueError(f"MOJITO_VAPID_SUBJECT {VAPID_SUBJECT!r} must start with mailto: or https://")
_check_public_url(PUBLIC_URL)
ZoneInfo(TIMEZONE)  # an unknown zone fails here (ZoneInfoNotFoundError), not at the first day boundary
if not re.fullmatch(r"\S+", OWNER_NAME):
    raise ValueError(f"MOJITO_OWNER_NAME {OWNER_NAME!r} must be one word without spaces")
if not re.fullmatch(r"[^@\s]+@[^@\s]+", CONTACT_EMAIL):
    raise ValueError(f"MOJITO_CONTACT_EMAIL {CONTACT_EMAIL!r} is not an email address")
if not Path(WEB_DIR).is_dir():
    raise FileNotFoundError(f"MOJITO_WEB_DIR {WEB_DIR} is not a directory")
VAPID, VAPID_PUBLIC_KEY = _load_vapid(VAPID_KEY_FILE)  # public key: 65-byte point, base64url, no padding
