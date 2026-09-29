"""FCM HTTP v1, data messages only. google-auth is used just to sign the service-account
JWT; the token exchange and sends go through urllib (no requests/urllib3).
Runs in worker threads; no DB access here."""

import json
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

from google.auth import crypt, jwt

from . import config

SCOPE = "https://www.googleapis.com/auth/firebase.messaging"

with open(config.FCM_CREDENTIALS) as _f:
    _INFO = json.load(_f)
_SIGNER = crypt.RSASigner.from_service_account_info(_INFO)
_SEND_URL = f"https://fcm.googleapis.com/v1/projects/{_INFO['project_id']}/messages:send"

_lock = threading.Lock()
_token: tuple[str, float] | None = None  # (access_token, expires_at)


def _access_token() -> str:
    global _token
    with _lock:
        if _token is not None and _token[1] > time.time() + 60:
            return _token[0]
        now = int(time.time())
        assertion = jwt.encode(_SIGNER, {
            "iss": _INFO["client_email"], "scope": SCOPE, "aud": _INFO["token_uri"],
            "iat": now, "exp": now + 3600,
        })
        form = urllib.parse.urlencode({
            "grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer",
            "assertion": assertion.decode(),
        }).encode()
        try:
            with urllib.request.urlopen(urllib.request.Request(_INFO["token_uri"], data=form), timeout=15) as resp:
                body = json.load(resp)
        except urllib.error.HTTPError as e:
            raise RuntimeError(f"FCM token exchange failed: HTTP {e.code} {e.read().decode()}") from e
        _token = (body["access_token"], now + body["expires_in"])
        return _token[0]


def send(tokens: list[str], data: dict[str, str], high_priority: bool) -> list[str]:
    """Send one data message to each device token. Returns tokens FCM reports as
    UNREGISTERED (the app was uninstalled or the token rotated); other errors raise."""
    auth = f"Bearer {_access_token()}"
    unregistered = []
    for token in tokens:
        msg = {"message": {"token": token, "data": data,
                           "android": {"priority": "high" if high_priority else "normal"}}}
        req = urllib.request.Request(
            _SEND_URL, data=json.dumps(msg).encode(), method="POST",
            headers={"Authorization": auth, "Content-Type": "application/json"},
        )
        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                resp.read()
        except urllib.error.HTTPError as e:
            detail = e.read().decode()
            if e.code == 404 and "UNREGISTERED" in detail:
                unregistered.append(token)
                continue
            raise RuntimeError(f"FCM send failed: HTTP {e.code} {detail}") from e
    return unregistered
