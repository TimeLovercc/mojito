"""Report external authorization health to the hub (PUT /auth-status/{name})."""
import logging
import time

import google.auth.exceptions

from mojito_worker import claude, gmail
from mojito_worker.config import GOOGLE_OAUTH_FILE
from mojito_worker.hub import Hub
from mojito_worker.local_facts import LocalFactError

GMAIL_READ = "gmail-read"
CLAUDE_MAC = "claude-mac"
GMAIL_CHECK_INTERVAL_S = 3600

log = logging.getLogger("mojito_worker.auth")


class AuthReporter:
    def __init__(self, hub: Hub):
        self.hub = hub
        self.gmail_checked_at: float | None = None
        self.claude_reported: bool | None = None

    def check_gmail_if_due(self) -> None:
        """On start and hourly: exchange the refresh token for an access token."""
        now = time.monotonic()
        if self.gmail_checked_at is not None and now - self.gmail_checked_at < GMAIL_CHECK_INTERVAL_S:
            return
        self.gmail_checked_at = now
        try:
            gmail.access_token()
        except LocalFactError:
            self.hub.put_auth_status(GMAIL_READ, False, f"missing {GOOGLE_OAUTH_FILE}")
            return
        except google.auth.exceptions.RefreshError as e:
            self.hub.put_auth_status(GMAIL_READ, False, gmail.refresh_error_code(e))
            return
        except google.auth.exceptions.TransportError as e:
            # Network down (Mac just woke): says nothing about the grant; try again next hour.
            log.warning("gmail auth check skipped, network error: %s", e)
            return
        self.hub.put_auth_status(GMAIL_READ, True, None)

    def report_claude_if_changed(self) -> None:
        if claude.auth_ok is None or claude.auth_ok == self.claude_reported:
            return
        self.hub.put_auth_status(CLAUDE_MAC, claude.auth_ok, claude.auth_detail)
        self.claude_reported = claude.auth_ok
