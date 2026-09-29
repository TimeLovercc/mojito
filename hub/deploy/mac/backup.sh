#!/bin/bash
# Nightly backup (launchd, 03:00 local time): an online SQLite snapshot of
# hub.db plus the attachments directory, pulled from the server into ~/mojito-backup/.
# MOJITO_SSH_HOST comes from the launchd job (hub/deploy/mac/install.sh writes it into the plist).
# Snapshots are kept 14 days; attachments are synced incrementally (never deleted
# here). On any failure a macOS notification is shown. Log: ~/Library/Logs/mojito-backup.log
set -euo pipefail

HOST="${MOJITO_SSH_HOST:?MOJITO_SSH_HOST not set (re-run hub/deploy/mac/install.sh)}"
DEST="$HOME/mojito-backup"
STAMP=$(date +%Y%m%d)
REMOTE_SNAP=/var/lib/mojito/snapshots/hub-$STAMP.db

notify() {
  /usr/bin/osascript -e "display notification \"$1\" with title \"Mojito\""
}
trap 'notify "备份失败（第 $LINENO 行），详情见 ~/Library/Logs/mojito-backup.log"' ERR

echo "== $(date '+%F %T') backup start"
mkdir -p "$DEST/snapshots" "$DEST/attachments"
chmod 700 "$DEST"

# Consistent online snapshot on the server: the hub's own snapshot command (sqlite
# backup API, integrity-checked, single self-contained file). It reads MOJITO_DB;
# uv needs the UV_* paths from the same env file.
/usr/bin/ssh "$HOST" "sudo install -d -o mojito -g mojito -m 700 /var/lib/mojito/snapshots && sudo sh -c 'cd /opt/mojito/hub && sudo -u mojito env \$(grep -E \"^(UV_[A-Z_]+|MOJITO_DB)=\" /var/lib/mojito/env) /usr/local/bin/uv run --frozen --no-sync python -m mojito_hub.snapshot $REMOTE_SNAP'"

/usr/bin/rsync -a --rsync-path='sudo rsync' "$HOST:$REMOTE_SNAP" "$DEST/snapshots/"
/usr/bin/ssh "$HOST" "sudo rm $REMOTE_SNAP"
/usr/bin/rsync -a --rsync-path='sudo rsync' "$HOST:/var/lib/mojito/attachments/" "$DEST/attachments/"

# Re-check the copy after transfer.
/usr/bin/sqlite3 "$DEST/snapshots/hub-$STAMP.db" 'PRAGMA integrity_check;' | grep -qx ok

/usr/bin/find "$DEST/snapshots" -name 'hub-*.db' -mtime +14 -delete
echo "== $(date '+%F %T') backup done: snapshots/hub-$STAMP.db ($(du -h "$DEST/snapshots/hub-$STAMP.db" | cut -f1)), attachments $(ls "$DEST/attachments" | wc -l | tr -d ' ') files"
