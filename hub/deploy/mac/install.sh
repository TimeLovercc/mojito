#!/bin/bash
# Install (or reinstall) the Mac-side launchd jobs:
#   com.example.mojito.backup  - backup.sh daily at 03:00 local time (the Mac's timezone must be MOJITO_TIMEZONE)
#   com.example.mojito.health  - healthcheck.sh every 10 minutes
# Scripts are copied to ~/.local/share/mojito/bin so the jobs don't depend on a
# worktree path. MOJITO_SSH_HOST and MOJITO_HUB_URL are written into the plists.
# Run from the repo with hub/deploy/deploy.env loaded: hub/deploy/mac/install.sh
set -euo pipefail

HOST="${MOJITO_SSH_HOST:?set MOJITO_SSH_HOST (ssh alias of your server)}"
HUB_URL="${MOJITO_HUB_URL:?set MOJITO_HUB_URL (public https address of the hub)}"
TZ_NAME="${MOJITO_TIMEZONE:?set MOJITO_TIMEZONE (your IANA timezone)}"

SRC=$(cd "$(dirname "$0")" && pwd)
BIN="$HOME/.local/share/mojito/bin"
AGENTS="$HOME/Library/LaunchAgents"
UID_=$(id -u)

[ "$(readlink /etc/localtime | sed 's#.*/zoneinfo/##')" = "$TZ_NAME" ] || { echo "Mac timezone is not $TZ_NAME (MOJITO_TIMEZONE); 03:00 would be wrong" >&2; exit 1; }

mkdir -p "$BIN" "$AGENTS"
install -m 755 "$SRC/backup.sh" "$SRC/healthcheck.sh" "$BIN/"

plist() {  # label, script, schedule xml, log, env xml
  cat > "$AGENTS/$1.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$1</string>
  <key>ProgramArguments</key><array><string>/bin/bash</string><string>$BIN/$2</string></array>
  $3
  <key>EnvironmentVariables</key><dict>$5</dict>
  <key>StandardOutPath</key><string>$HOME/Library/Logs/$4</string>
  <key>StandardErrorPath</key><string>$HOME/Library/Logs/$4</string>
</dict>
</plist>
PLIST
  launchctl bootout "gui/$UID_/$1" 2>/dev/null || true
  launchctl bootstrap "gui/$UID_" "$AGENTS/$1.plist"
  echo "loaded $1"
}

plist com.example.mojito.backup backup.sh \
  '<key>StartCalendarInterval</key><dict><key>Hour</key><integer>3</integer><key>Minute</key><integer>0</integer></dict>' \
  mojito-backup.log \
  "<key>MOJITO_SSH_HOST</key><string>$HOST</string>"
plist com.example.mojito.health healthcheck.sh \
  '<key>StartInterval</key><integer>600</integer><key>RunAtLoad</key><true/>' \
  mojito-health.log \
  "<key>MOJITO_HUB_URL</key><string>$HUB_URL</string>"
