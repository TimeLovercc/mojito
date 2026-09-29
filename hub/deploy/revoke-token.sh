#!/usr/bin/env bash
# Revoke the one token whose token_ref (first 16 hex of sha256(token)) matches,
# then restart the hub; on start the hub drops that token's Web Push
# subscriptions. Run from your computer (hub/deploy/deploy.env.example):
#   ssh "$MOJITO_SSH_HOST" 'sudo bash -s <token_ref>' < hub/deploy/revoke-token.sh
set -euo pipefail

REF="$1"
[[ "$REF" =~ ^[0-9a-f]{16}$ ]] || { echo "token_ref must be 16 lowercase hex characters, got '$REF'" >&2; exit 1; }

umask 077
python3 - /var/lib/mojito/tokens.json "$REF" <<'PY'
import hashlib, json, sys
path, ref = sys.argv[1], sys.argv[2]
with open(path) as f:
    tokens = json.load(f)
matches = [t for t in tokens if hashlib.sha256(t.encode()).hexdigest()[:16] == ref]
if len(matches) != 1:
    sys.exit(f"expected exactly one token with token_ref {ref}, found {len(matches)}")
role = tokens.pop(matches[0])
with open(path + ".new", "w") as f:
    json.dump(tokens, f, indent=2)
print(f"revoked token_ref {ref} (role {role})")
PY
chown mojito:mojito /var/lib/mojito/tokens.json.new
chmod 600 /var/lib/mojito/tokens.json.new
mv /var/lib/mojito/tokens.json.new /var/lib/mojito/tokens.json

for i in $(seq 1 60); do
  n=$(sudo -u mojito python3 -c 'import sqlite3; print(sqlite3.connect("file:/var/lib/mojito/hub.db?mode=ro", uri=True).execute("SELECT count(*) FROM jobs WHERE status = ?", ("running",)).fetchone()[0])')
  [ "$n" = 0 ] && break
  sleep 2
done
systemctl restart mojito-hub
for i in $(seq 1 30); do
  [ "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8787/today || true)" = 401 ] && { echo "mojito-hub restarted"; exit 0; }
  sleep 1
done
echo "mojito-hub did not come back" >&2
exit 1
