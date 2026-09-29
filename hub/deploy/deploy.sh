#!/usr/bin/env bash
# Deploy a committed git ref to the server (hub + agent). Run from anywhere in the repo, with
# MOJITO_SSH_HOST and MOJITO_SECRETS_DIR set (hub/deploy/deploy.env.example):
#   hub/deploy/deploy.sh main "<用户能感知的变化，没有就写：无可见变化>"
# The note is required: on success it is pushed to the app as
# "服务器已更新：<first line>", body = the other lines (docs/api.md, 每次更新都推送通知), using the
# source:cards token in $MOJITO_SECRETS_DIR/cards.env.
# Pushes <ref> to <server>:/srv/mojito.git, backs up hub.db, resets /opt/mojito to
# the ref, syncs both venvs, installs both systemd units, waits for the agent to
# be idle, restarts mojito-hub and mojito-agent, and checks that the hub answers
# and the agent stays up.
set -euo pipefail

REF="$1"
NOTE="$2"
[ -n "$NOTE" ] || { echo "deploy.sh: the second argument (user-visible change) is empty" >&2; exit 1; }
HOST="${MOJITO_SSH_HOST:?set MOJITO_SSH_HOST (ssh alias of your server)}"
SHA=$(git rev-parse --verify "$REF^{commit}")
CARDS_ENV="${MOJITO_SECRETS_DIR:?set MOJITO_SECRETS_DIR (folder holding cards.env)}/cards.env"
test -r "$CARDS_ENV"

git push --force "$HOST:/srv/mojito.git" "$SHA:refs/heads/deploy"

ssh "$HOST" "sudo bash -s $SHA" <<'REMOTE'
set -euo pipefail
SHA="$1"

if [ -f /var/lib/mojito/hub.db ]; then
  install -d -o mojito -g mojito -m 700 /var/lib/mojito/backups
  OLD=$(git -c safe.directory=/opt/mojito -C /opt/mojito rev-parse --short HEAD)
  BACKUP=/var/lib/mojito/backups/hub-$(date -u +%Y%m%dT%H%M%SZ)-$OLD.db
  sudo -u mojito python3 -c 'import sqlite3, sys; src = sqlite3.connect(sys.argv[1]); dst = sqlite3.connect(sys.argv[2]); src.backup(dst); dst.close()' /var/lib/mojito/hub.db "$BACKUP"
  echo "backed up hub.db -> $BACKUP"
fi

cd /opt/mojito
[ -d .git ] || git init --quiet
GIT="git -c safe.directory=/opt/mojito"
$GIT fetch --quiet /srv/mojito.git deploy
$GIT reset --quiet --hard "$SHA"
$GIT clean --quiet -fdx
chown -R mojito:mojito /opt/mojito

sudo -u mojito env $(grep '^UV_' /var/lib/mojito/env) \
  /usr/local/bin/uv sync --frozen --no-dev --project /opt/mojito/hub
sudo -u mojito env $(grep '^UV_' /var/lib/mojito/agent.env) \
  /usr/local/bin/uv sync --frozen --no-dev --project /opt/mojito/agent

# Preflight: import the hub's config with the real env as the service user. Every
# required variable and credential is checked at import, so a bad env stops the
# deploy here, while the old hub and agent are still running. set -f: env values
# (e.g. URLs) must not be glob-expanded when split into arguments.
set -f
( cd /opt/mojito/hub && sudo -u mojito env $(grep -v '^#' /var/lib/mojito/env) \
    /usr/local/bin/uv run --frozen --no-sync python -c 'import mojito_hub.config' )
set +f
echo "preflight ok: mojito_hub.config imports with /var/lib/mojito/env"

install -m 644 /opt/mojito/hub/deploy/mojito-hub.service /etc/systemd/system/mojito-hub.service
install -m 644 /opt/mojito/agent/deploy/mojito-agent.service /etc/systemd/system/mojito-agent.service
systemctl daemon-reload
systemctl enable --quiet mojito-hub mojito-agent

# Don't cut off a job mid-flight: a hub restart makes the server agent AND the Mac
# worker fail their next hub call (the job then sits in `running` until the
# watchdog requeues it after 30 min). Wait (max 2 min) until no job is running on
# any runner, then stop the agent so it can't lease a new one while the hub restarts.
running_jobs() {
  [ -f /var/lib/mojito/hub.db ] || { echo 0; return; }
  sudo -u mojito python3 -c 'import sqlite3, sys; print(sqlite3.connect(f"file:{sys.argv[1]}?mode=ro", uri=True).execute("SELECT count(*) FROM jobs WHERE status = ?", ("running",)).fetchone()[0])' /var/lib/mojito/hub.db
}
for i in $(seq 1 60); do
  [ "$(running_jobs)" = 0 ] && break
  [ "$i" = 1 ] && echo "waiting for running jobs to finish (max 2 min)..."
  sleep 2
done
n=$(running_jobs)
[ "$n" = 0 ] || echo "WARNING: restarting with $n job(s) still running; check GET /jobs?status=running afterwards (the watchdog requeues them after 30 min)"
systemctl stop mojito-agent

systemctl restart mojito-hub

hub_up=no
for i in $(seq 1 30); do
  code=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8787/today || true)
  [ "$code" = 401 ] && { hub_up=yes; break; }
  sleep 1
done
if [ "$hub_up" != yes ]; then
  systemctl status --no-pager mojito-hub
  journalctl -u mojito-hub -n 40 --no-pager
  exit 1
fi
echo "mojito-hub up at $SHA (unauthenticated /today -> 401)"

systemctl start mojito-agent
sleep 15
if [ "$(systemctl show mojito-agent -p NRestarts --value)" != 0 ] || ! systemctl is-active --quiet mojito-agent; then
  systemctl status --no-pager mojito-agent
  journalctl -u mojito-agent -n 40 --no-pager
  exit 1
fi
echo "mojito-agent up at $SHA ($(systemctl show mojito-agent -p MemoryCurrent))"
REMOTE

# Tell the user. Title uses the note's first line; the body is the remaining lines
# (or the first line again when the note is a single line).
( set -a; . "$CARDS_ENV"; set +a
  python3 - "$NOTE" <<'PY_EVENT'
import json, os, sys, urllib.request
lines = sys.argv[1].strip().splitlines()
headline, rest = lines[0].strip(), "\n".join(lines[1:]).strip()
event = {"kind": "log", "tier": "digest", "item_id": None, "project_id": None, "repo_path": None,
         "title": "服务器已更新：" + headline, "body": rest if rest else headline, "evidence": None}
req = urllib.request.Request(os.environ["MOJITO_HUB_URL"] + "/events", data=json.dumps(event).encode(), method="POST",
                             headers={"Authorization": "Bearer " + os.environ["MOJITO_CARDS_TOKEN"], "Content-Type": "application/json"})
with urllib.request.urlopen(req, timeout=20) as resp:
    print("pushed:", json.load(resp)["title"])
PY_EVENT
)
