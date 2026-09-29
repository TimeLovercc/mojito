#!/usr/bin/env bash
# Generate the Web Push VAPID private key on the server (P-256, SEC1 PEM) if it does
# not exist yet, and point MOJITO_VAPID_KEY_FILE at it. The key never leaves the
# server and is never printed. Run from your computer (hub/deploy/deploy.env.example):
#   ssh "$MOJITO_SSH_HOST" 'sudo bash -s' < hub/deploy/gen-vapid.sh
# Rotating: see README (delete the pem, re-run, clear webpush_subscriptions).
set -euo pipefail

KEY=/var/lib/mojito/vapid.pem
ENV=/var/lib/mojito/env

umask 077
if [ ! -e "$KEY" ]; then
  openssl ecparam -name prime256v1 -genkey -noout -out "$KEY"
  echo "generated $KEY"
else
  echo "$KEY exists; left unchanged"
fi
chown mojito:mojito "$KEY"
chmod 600 "$KEY"
openssl ec -in "$KEY" -noout -check 2>&1 | grep -qx "EC Key valid."
openssl ec -in "$KEY" -noout -text 2>/dev/null | grep -q "NIST CURVE: P-256"

grep -v '^MOJITO_VAPID_KEY_FILE=' "$ENV" > "$ENV.new"
echo "MOJITO_VAPID_KEY_FILE=$KEY" >> "$ENV.new"
chmod 600 "$ENV.new"
mv "$ENV.new" "$ENV"
echo "MOJITO_VAPID_KEY_FILE -> $ENV"
