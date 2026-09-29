#!/usr/bin/env bash
# Add one more `app` token (one per device, e.g. an iPhone running the web app)
# to /var/lib/mojito/tokens.json and restart the hub. Run from your computer (hub/deploy/deploy.env.example):
#   ssh "$MOJITO_SSH_HOST" 'sudo bash -s' < hub/deploy/add-app-token.sh | pbcopy
# The token goes to stdout only (no newline, straight into the clipboard); its
# token_ref (first 16 hex of sha256) goes to stderr - note it as "<device> = <ref>"
# so the device can be revoked later with revoke-token.sh.
set -euo pipefail

umask 077
python3 - /var/lib/mojito/tokens.json <<'PY'
import hashlib, json, secrets, sys
path = sys.argv[1]
with open(path) as f:
    tokens = json.load(f)
token = secrets.token_urlsafe(32)
tokens[token] = "app"
with open(path + ".new", "w") as f:
    json.dump(tokens, f, indent=2)
sys.stdout.write(token)
sys.stderr.write(f"token_ref: {hashlib.sha256(token.encode()).hexdigest()[:16]}\n")
PY
chown mojito:mojito /var/lib/mojito/tokens.json.new
chmod 600 /var/lib/mojito/tokens.json.new
mv /var/lib/mojito/tokens.json.new /var/lib/mojito/tokens.json

# Restart when no job is mid-flight (max 2 min), like deploy.sh.
for i in $(seq 1 60); do
  n=$(sudo -u mojito python3 -c 'import sqlite3; print(sqlite3.connect("file:/var/lib/mojito/hub.db?mode=ro", uri=True).execute("SELECT count(*) FROM jobs WHERE status = ?", ("running",)).fetchone()[0])')
  [ "$n" = 0 ] && break
  sleep 2
done
systemctl restart mojito-hub
for i in $(seq 1 30); do
  [ "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8787/today || true)" = 401 ] && { echo "mojito-hub restarted" >&2; exit 0; }
  sleep 1
done
echo "mojito-hub did not come back" >&2
exit 1
