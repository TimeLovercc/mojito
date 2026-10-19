#!/usr/bin/env bash
# Generate the HMAC key that signs page links (/p/…, docs/api.md 页面) on the server if it does
# not exist yet, and point MOJITO_PAGES_KEY_FILE at it. The key never leaves the server and
# is never printed. Run from your computer:
#   ssh "$MOJITO_SSH_HOST" 'sudo bash -s' < hub/deploy/gen-pages-key.sh
# Rotating: delete the key file, re-run, restart mojito-hub (open links stop working).
set -euo pipefail

KEY=/var/lib/mojito/pages-link.key
ENV=/var/lib/mojito/env

umask 077
if [ ! -e "$KEY" ]; then
  python3 -c 'import secrets; print(secrets.token_hex(32))' > "$KEY"
  echo "generated $KEY"
else
  echo "$KEY exists; left unchanged"
fi
chown mojito:mojito "$KEY"
chmod 600 "$KEY"
python3 -c 'import sys; k = bytes.fromhex(open(sys.argv[1]).read().strip()); assert len(k) >= 32, len(k)' "$KEY"

grep -v '^MOJITO_PAGES_KEY_FILE=' "$ENV" > "$ENV.new"
echo "MOJITO_PAGES_KEY_FILE=$KEY" >> "$ENV.new"
chmod 600 "$ENV.new"
mv "$ENV.new" "$ENV"
echo "MOJITO_PAGES_KEY_FILE -> $ENV"
