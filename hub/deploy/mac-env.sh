#!/usr/bin/env bash
# Write a local env file holding the hub URL and the token of one role, taken
# from the server's tokens.json without printing it. Needs MOJITO_SSH_HOST and
# MOJITO_HUB_URL (hub/deploy/deploy.env.example). Run from your computer, e.g.:
#   hub/deploy/mac-env.sh source:cards MOJITO_CARDS_TOKEN "$MOJITO_SECRETS_DIR/cards.env"
#   hub/deploy/mac-env.sh maintainer MOJITO_MAINTAINER_TOKEN "$MOJITO_SECRETS_DIR/maintainer.env"
# Overwrites the file (mode 600).
set -euo pipefail

ROLE="$1"
VAR="$2"
OUT="$3"
HOST="${MOJITO_SSH_HOST:?set MOJITO_SSH_HOST (ssh alias of your server)}"
HUB_URL="${MOJITO_HUB_URL:?set MOJITO_HUB_URL (public https address of the hub)}"

TOKEN=$(ssh "$HOST" "sudo python3 -c '
import json, sys
matches = [t for t, r in json.load(open(\"/var/lib/mojito/tokens.json\")).items() if r == sys.argv[1]]
assert len(matches) == 1, f\"expected one token for role {sys.argv[1]}, found {len(matches)}\"
print(matches[0])
' $ROLE")

umask 077
printf 'MOJITO_HUB_URL=%s\n%s=%s\n' "$HUB_URL" "$VAR" "$TOKEN" > "$OUT"
chmod 600 "$OUT"
echo "wrote $OUT ($VAR for role $ROLE)"
