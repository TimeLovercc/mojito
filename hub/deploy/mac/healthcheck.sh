#!/bin/bash
# Every 10 minutes (launchd): GET the hub's public page at MOJITO_HUB_URL (written into the plist
# by hub/deploy/mac/install.sh).
# Two consecutive failures -> macOS notification "Mojito hub 连不上"; the first
# success after that -> "Mojito hub 恢复了". Log: ~/Library/Logs/mojito-health.log
set -euo pipefail

URL="${MOJITO_HUB_URL:?MOJITO_HUB_URL not set (re-run hub/deploy/mac/install.sh)}/"
STATE="$HOME/.local/share/mojito/health-failures"

notify() {
  /usr/bin/osascript -e "display notification \"$1\" with title \"Mojito\""
}

mkdir -p "$(dirname "$STATE")"
[ -f "$STATE" ] || echo 0 > "$STATE"
failures=$(cat "$STATE")

code=$(/usr/bin/curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$URL" || true)
if [ "$code" = 200 ]; then
  [ "$failures" -ge 2 ] && notify "Mojito hub 恢复了"
  echo 0 > "$STATE"
  exit 0
fi

failures=$((failures + 1))
echo "$failures" > "$STATE"
echo "$(date '+%F %T') $URL -> ${code} (consecutive failures: $failures)"
[ "$failures" = 2 ] && notify "Mojito hub 连不上（$URL 返回 ${code}）"
exit 0
