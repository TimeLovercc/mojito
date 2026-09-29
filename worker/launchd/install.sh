#!/bin/bash
# Render the plist with this checkout's paths, copy it to ~/Library/LaunchAgents and (re)load it.
set -euo pipefail

LABEL=com.example.mojito.worker
WORKER_DIR="$(cd "$(dirname "$0")/.." && pwd)"
UV="$(command -v uv)"
LOG="$HOME/Library/Logs/mojito-worker.log"
DEST="$HOME/Library/LaunchAgents/$LABEL.plist"

test -f "$WORKER_DIR/.env" || { echo "missing $WORKER_DIR/.env (copy worker/.env.example and fill it in)" >&2; exit 1; }
for key in MOJITO_HUB_URL MOJITO_WORKER_TOKEN MOJITO_CLAUDE_BIN MOJITO_TIMEZONE MOJITO_PROJECTS_ROOT \
           MOJITO_GMAIL_OAUTH_FILE MOJITO_ZOTERO_DB MOJITO_ARXIV_CATEGORIES; do
  grep -q "^$key=." "$WORKER_DIR/.env" || { echo "$key not set in $WORKER_DIR/.env" >&2; exit 1; }
done

(cd "$WORKER_DIR" && "$UV" sync)

mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
sed -e "s|__UV__|$UV|g" -e "s|__WORKER_DIR__|$WORKER_DIR|g" -e "s|__LOG__|$LOG|g" -e "s|__HOME__|$HOME|g" \
    "$WORKER_DIR/launchd/$LABEL.plist" > "$DEST"
plutil -lint "$DEST"

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true  # not loaded yet on first install
launchctl bootstrap "gui/$(id -u)" "$DEST"
echo "loaded $LABEL; log: $LOG"
launchctl print "gui/$(id -u)/$LABEL" | grep -E 'state|pid' | head -3
