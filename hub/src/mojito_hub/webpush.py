"""Web Push (RFC 8030 / 8291 aes128gcm / 8292 VAPID) for the iPhone PWA (api.md iPhone 网页版).

Runs on its own single-thread executor so it never competes with FCM, attachments or the
calendar for the default pool. No DB access here: the caller passes subscription rows in and
gets back which endpoints are gone (404/410) and which failed otherwise."""

import base64
import threading
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import urlsplit

import http_ece
from cryptography.hazmat.primitives.asymmetric import ec

from . import config

EXECUTOR = ThreadPoolExecutor(max_workers=1, thread_name_prefix="webpush")
TTL_S = 86400
TIMEOUT_S = 10
JWT_LIFETIME_S = 12 * 3600
JWT_RENEW_BEFORE_S = 3600
URGENCY = {"interrupt": "high", "digest": "normal", "quiet": "low"}
MAX_PLAINTEXT = 3993  # encrypted body stays within 4096 bytes


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    """A redirect is an error here (3xx raises HTTPError)."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


_opener = urllib.request.build_opener(_NoRedirect)
_jwt_lock = threading.Lock()
_jwt_cache: dict[str, tuple[str, float]] = {}  # aud → (Authorization header, exp)


def _authorization(endpoint: str) -> str:
    parts = urlsplit(endpoint)
    aud = f"{parts.scheme}://{parts.netloc}"
    now = time.time()
    with _jwt_lock:
        if aud in _jwt_cache and _jwt_cache[aud][1] - now > JWT_RENEW_BEFORE_S:
            return _jwt_cache[aud][0]
        exp = int(now) + JWT_LIFETIME_S
        header = config.VAPID.sign({"aud": aud, "sub": config.VAPID_SUBJECT, "exp": exp})["Authorization"]
        _jwt_cache[aud] = (header, exp)
        return header


def _b64url(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def _send_one(sub: dict, plaintext: bytes, urgency: str) -> None:
    body = http_ece.encrypt(
        plaintext, private_key=ec.generate_private_key(ec.SECP256R1()),
        dh=_b64url(sub["p256dh"]), auth_secret=_b64url(sub["auth"]), version="aes128gcm",
    )
    req = urllib.request.Request(sub["endpoint"], data=body, method="POST", headers={
        "TTL": str(TTL_S), "Urgency": urgency, "Content-Encoding": "aes128gcm",
        "Content-Type": "application/octet-stream", "Authorization": _authorization(sub["endpoint"]),
    })
    with _opener.open(req, timeout=TIMEOUT_S) as resp:
        resp.read()


def send(subs: list[dict], plaintext: bytes, tier: str) -> tuple[list[str], list[str]]:
    """Send to every subscription; one failure never stops the others.
    Returns (endpoints gone with 404/410, error lines without endpoint paths)."""
    gone, errors = [], []
    for sub in subs:
        host = urlsplit(sub["endpoint"]).hostname
        try:
            _send_one(sub, plaintext, URGENCY[tier])
        except urllib.error.HTTPError as e:
            if e.code in (404, 410):
                gone.append(sub["endpoint"])
            else:
                errors.append(f"{host} HTTP {e.code} Retry-After={e.headers['Retry-After']}")
        except OSError as e:  # network errors, timeouts (URLError is an OSError)
            errors.append(f"{host} {type(e).__name__}: {e}")
    return gone, errors
