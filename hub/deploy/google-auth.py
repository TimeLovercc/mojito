# /// script
# requires-python = ">=3.12"
# dependencies = ["google-auth-oauthlib>=1.2"]
# ///
"""One-time Google authorization on your computer, one scope per credential file. The client
JSON is a Desktop OAuth client from your own Google Cloud project.

    uv run hub/deploy/google-auth.py --client "$MOJITO_SECRETS_DIR/google-client.json" \
        --scope calendar --out "$MOJITO_SECRETS_DIR/google-oauth-calendar.json"
    uv run hub/deploy/google-auth.py --client "$MOJITO_SECRETS_DIR/google-client.json" \
        --scope gmail --out "$MOJITO_SECRETS_DIR/google-oauth-gmail.json"

Prints the consent URL (open it in a browser signed in as the user), waits for the
redirect on a local port, and writes the authorized-user JSON (with refresh token)
to --out, mode 600. The calendar file goes to the server via install-secrets.sh; the
Gmail file never leaves your computer (docs/design.md 9.6; worker/.env MOJITO_GMAIL_OAUTH_FILE).
"""

import argparse
import os

from google_auth_oauthlib.flow import InstalledAppFlow

SCOPES = {
    "calendar": "https://www.googleapis.com/auth/calendar.events",
    "gmail": "https://www.googleapis.com/auth/gmail.readonly",
}

parser = argparse.ArgumentParser()
parser.add_argument("--client", required=True, help="Desktop OAuth client JSON")
parser.add_argument("--scope", required=True, choices=sorted(SCOPES))
parser.add_argument("--out", required=True, help="authorized-user JSON to write (mode 600)")
args = parser.parse_args()

scope = SCOPES[args.scope]
flow = InstalledAppFlow.from_client_secrets_file(args.client, [scope])
creds = flow.run_local_server(port=0, open_browser=False, access_type="offline", prompt="consent")
if not creds.refresh_token:
    raise SystemExit("Google returned no refresh token; revoke mojito at https://myaccount.google.com/permissions and re-run")
if set(creds.granted_scopes) != {scope}:
    raise SystemExit(f"granted scopes {sorted(creds.granted_scopes)} != [{scope}] (tick the checkbox on the consent screen)")

fd = os.open(args.out, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
with os.fdopen(fd, "w") as f:
    f.write(creds.to_json())
os.chmod(args.out, 0o600)
print(f"wrote {args.out} (scope: {scope})")
