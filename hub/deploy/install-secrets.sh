#!/usr/bin/env bash
# Copy the user-provided secrets from your computer ($MOJITO_SECRETS_DIR) to the server
# without printing them:
#   claude-oauth-token        -> agent.env  CLAUDE_CODE_OAUTH_TOKEN
#   ical-url                  -> env        MOJITO_ICAL_URL
#                                 no calendar: file:///var/lib/mojito/empty.ics (setup-server.sh creates it)
#   ical-extra-urls           -> /var/lib/mojito/ical-extra-urls    (env MOJITO_ICAL_EXTRA_FILE)
#                                one https:// or webcal:// ICS link per line, shown read-only (e.g. a work or
#                                school Outlook calendar); empty file = no subscribed calendars
#   google-oauth-calendar.json -> /var/lib/mojito/google-oauth.json (agent.env MOJITO_GOOGLE_OAUTH)
#                                 must hold exactly calendar.events; optional: without it the agent runs
#                                 without calendar writes (System shows the grant as not connected)
#   google-oauth-gmail.json is never sent: Gmail access stays on the Mac (docs/design.md 9.6).
#   fcm-service-account.json  -> /var/lib/mojito/fcm.json           (env MOJITO_FCM_CREDENTIALS)
# Run from your computer with hub/deploy/deploy.env loaded: hub/deploy/install-secrets.sh
# Also writes the non-secret settings into env (docs/api.md, iPhone 网页版):
#   MOJITO_OWNER_NAME    = $MOJITO_OWNER_NAME, who runs the instance, shown on / and /privacy (no spaces)
#   MOJITO_CONTACT_EMAIL = $MOJITO_CONTACT_EMAIL, the public contact address on / and /privacy
#   MOJITO_VAPID_SUBJECT = mailto:<the same address>
#   MOJITO_PUBLIC_URL    = $MOJITO_HUB_URL, no trailing slash
#   MOJITO_TIMEZONE      = $MOJITO_TIMEZONE (hub env and agent.env)
#   MOJITO_WEB_DIR       = /opt/mojito-web/current
# Re-running replaces the values. Restart the services afterwards (deploy.sh does).
set -euo pipefail

HOST="${MOJITO_SSH_HOST:?set MOJITO_SSH_HOST (ssh alias of your server)}"
SECRETS="${MOJITO_SECRETS_DIR:?set MOJITO_SECRETS_DIR (folder holding the secret files)}"
: "${MOJITO_OWNER_NAME:?set MOJITO_OWNER_NAME (shown on the public pages, no spaces)}"
: "${MOJITO_CONTACT_EMAIL:?set MOJITO_CONTACT_EMAIL (public contact address)}"
: "${MOJITO_HUB_URL:?set MOJITO_HUB_URL (public https address of the hub)}"
: "${MOJITO_TIMEZONE:?set MOJITO_TIMEZONE (your IANA timezone)}"

# set_env <env-file> <key>: value is read from stdin (one line, no spaces).
set_env() {
  local dest="$1" key="$2"
  ssh "$HOST" "sudo python3 -c '
import sys
dest, key = sys.argv[1], sys.argv[2]
value = sys.stdin.read().strip()
assert value and \"\\n\" not in value and \" \" not in value, f\"{key}: value must be one non-empty line without spaces\"
with open(dest) as f:
    lines = [l for l in f.read().splitlines() if not l.startswith(key + \"=\")]
lines.append(key + \"=\" + value)
with open(dest, \"w\") as f:
    f.write(\"\\n\".join(lines) + \"\\n\")
print(key, \"->\", dest)
' $dest $key && sudo chmod 600 $dest && sudo chown root:root $dest"
}

# put_file <local-file> <remote-path>: mojito-owned, mode 600.
put_file() {
  local src="$1" dest="$2"
  ssh "$HOST" "sudo sh -c 'umask 077 && cat > $dest && chown mojito:mojito $dest && chmod 600 $dest' && echo '$(basename "$src") -> $dest'" < "$src"
}

test -s "$SECRETS/claude-oauth-token"
set_env /var/lib/mojito/agent.env CLAUDE_CODE_OAUTH_TOKEN < "$SECRETS/claude-oauth-token"
test -s "$SECRETS/ical-url"
set_env /var/lib/mojito/env MOJITO_ICAL_URL < "$SECRETS/ical-url"

if [ -f "$SECRETS/google-oauth-calendar.json" ]; then
  python3 -c '
import json, sys
scopes = json.load(open(sys.argv[1]))["scopes"]
assert scopes == ["https://www.googleapis.com/auth/calendar.events"], f"calendar credential must hold only calendar.events, got {scopes}"
' "$SECRETS/google-oauth-calendar.json"
  put_file "$SECRETS/google-oauth-calendar.json" /var/lib/mojito/google-oauth.json
else
  echo "no $SECRETS/google-oauth-calendar.json: calendar writes stay off (docs/SETUP.md section 5)"
fi
echo /var/lib/mojito/google-oauth.json | set_env /var/lib/mojito/agent.env MOJITO_GOOGLE_OAUTH

python3 -c 'import json, sys; json.load(open(sys.argv[1]))' "$SECRETS/fcm-service-account.json"
put_file "$SECRETS/fcm-service-account.json" /var/lib/mojito/fcm.json
echo /var/lib/mojito/fcm.json | set_env /var/lib/mojito/env MOJITO_FCM_CREDENTIALS

# Subscribed ICS links are secrets too: errors name the line number, never the link.
test -f "$SECRETS/ical-extra-urls"
python3 -c '
import sys
for n, line in enumerate(open(sys.argv[1]).read().splitlines(), 1):
    line = line.strip()
    assert not line or (line.startswith(("https://", "webcal://")) and " " not in line), f"ical-extra-urls line {n}: must be one https:// or webcal:// link"
' "$SECRETS/ical-extra-urls"
put_file "$SECRETS/ical-extra-urls" /var/lib/mojito/ical-extra-urls
echo /var/lib/mojito/ical-extra-urls | set_env /var/lib/mojito/env MOJITO_ICAL_EXTRA_FILE

EMAIL="$MOJITO_CONTACT_EMAIL"
[[ "$EMAIL" =~ ^[^@[:space:]]+@[^@[:space:]]+$ ]] || { echo "MOJITO_CONTACT_EMAIL is not an email address: '$EMAIL'" >&2; exit 1; }
echo "$MOJITO_OWNER_NAME" | set_env /var/lib/mojito/env MOJITO_OWNER_NAME
echo "$EMAIL" | set_env /var/lib/mojito/env MOJITO_CONTACT_EMAIL
echo "mailto:$EMAIL" | set_env /var/lib/mojito/env MOJITO_VAPID_SUBJECT
PUBLIC_URL=${MOJITO_HUB_URL%/}
[[ "$PUBLIC_URL" =~ ^https://[^/]+$ ]] || { echo "MOJITO_HUB_URL must be https://host without a path: '$PUBLIC_URL'" >&2; exit 1; }
echo "$PUBLIC_URL" | set_env /var/lib/mojito/env MOJITO_PUBLIC_URL
echo "$MOJITO_TIMEZONE" | set_env /var/lib/mojito/env MOJITO_TIMEZONE
echo "$MOJITO_TIMEZONE" | set_env /var/lib/mojito/agent.env MOJITO_TIMEZONE
echo /opt/mojito-web/current | set_env /var/lib/mojito/env MOJITO_WEB_DIR

# Nothing on the server may carry a Gmail grant (scope URL .../auth/gmail.*).
ssh "$HOST" "sudo grep -rl auth/gmail /var/lib/mojito --include='*.json' --include='*env' --exclude-dir=venv --exclude-dir=agent-venv --exclude-dir=python --exclude-dir=uv-cache --exclude-dir=.local --exclude-dir=.claude --exclude-dir=backups && exit 1 || echo 'no gmail credential on the server'"
