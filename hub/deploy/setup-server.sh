#!/usr/bin/env bash
# One-time server setup (a Debian/Ubuntu VM; 1GB of memory is enough for hub + agent).
# Run from your computer:
#   ssh "$MOJITO_SSH_HOST" 'sudo bash -s' < hub/deploy/setup-server.sh
# Creates the mojito user, /opt/mojito, /opt/mojito-web, /var/lib/mojito (+ env, agent.env), the
# bare repo /srv/mojito.git that deploy.sh pushes to (owned by the ssh user that ran sudo), and
# installs uv and Claude Code (native, for mojito). Safe to re-run; existing env files are left
# untouched. Secrets, tokens, timezone and contact address are added later by gen-tokens.sh and
# install-secrets.sh.
set -euo pipefail

: "${SUDO_USER:?run through sudo as the ssh user that deploy.sh pushes as}"
for cmd in git python3 curl; do
  command -v "$cmd" >/dev/null || { echo "setup-server.sh: $cmd is not installed" >&2; exit 1; }
done

id mojito >/dev/null 2>&1 || useradd --system --home-dir /var/lib/mojito --shell /usr/sbin/nologin mojito
install -d -o mojito -g mojito -m 700 /var/lib/mojito
install -d -o mojito -g mojito -m 755 /opt/mojito
install -d -o mojito -g mojito -m 700 /var/lib/mojito/attachments
# Web build (PWA): releases/<sha12>/ plus a `current` symlink, root-owned, read-only
# for the hub. Outside /opt/mojito because deploy.sh runs git clean there.
install -d -m 755 /opt/mojito-web/releases
if [ ! -e /opt/mojito-web/current ]; then
  install -d -m 755 /opt/mojito-web/releases/init
  ln -sfn releases/init /opt/mojito-web/current
fi

if [ ! -d /srv/mojito.git ]; then
  git init --quiet --bare --initial-branch=main /srv/mojito.git
  chown -R "$SUDO_USER:$SUDO_USER" /srv/mojito.git
fi

if [ ! -x /usr/local/bin/uv ]; then
  curl -LsSf https://astral.sh/uv/install.sh | env UV_INSTALL_DIR=/usr/local/bin UV_NO_MODIFY_PATH=1 sh
fi

if [ ! -f /var/lib/mojito/env ]; then
  cat > /var/lib/mojito/env <<ENV
MOJITO_DB=/var/lib/mojito/hub.db
MOJITO_TOKENS=/var/lib/mojito/tokens.json
MOJITO_SEED=/var/lib/mojito/seed.json
MOJITO_ATTACHMENTS_DIR=/var/lib/mojito/attachments
UV_PROJECT_ENVIRONMENT=/var/lib/mojito/venv
UV_PYTHON_INSTALL_DIR=/var/lib/mojito/python
UV_CACHE_DIR=/var/lib/mojito/uv-cache
ENV
  chown root:root /var/lib/mojito/env
  chmod 600 /var/lib/mojito/env
fi

# First-start seed (docs/SETUP.md 3.4): settings only, no goals. Edit it before the first start, or
# replace it with a populated example: examples/demo/demo_data.py seed --day today ...
if [ ! -f /var/lib/mojito/seed.json ]; then
  cat > /var/lib/mojito/seed.json <<'JSON'
{
  "settings": {"morning_at": "08:00", "evening_at": "21:30", "evening_enabled": true, "language": "en"},
  "goals": [], "plans": [], "items": [], "records": [], "projects": [], "item_projects": {}
}
JSON
  chown mojito:mojito /var/lib/mojito/seed.json
  chmod 600 /var/lib/mojito/seed.json
fi

# Empty calendar feed for an instance without a calendar: put file:///var/lib/mojito/empty.ics
# into $MOJITO_SECRETS_DIR/ical-url (docs/SETUP.md 3.2).
if [ ! -f /var/lib/mojito/empty.ics ]; then
  printf 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//mojito//empty//EN\r\nEND:VCALENDAR\r\n' > /var/lib/mojito/empty.ics
  chown mojito:mojito /var/lib/mojito/empty.ics
  chmod 600 /var/lib/mojito/empty.ics
fi

if [ ! -x /var/lib/mojito/.local/bin/claude ]; then
  sudo -u mojito -H bash -c 'cd ~ && curl -fsSL https://claude.ai/install.sh | bash'
fi

if [ ! -f /var/lib/mojito/agent.env ]; then
  cat > /var/lib/mojito/agent.env <<ENV
MOJITO_HUB_URL=http://127.0.0.1:8787
MOJITO_CLAUDE_BIN=/var/lib/mojito/.local/bin/claude
UV_PROJECT_ENVIRONMENT=/var/lib/mojito/agent-venv
UV_PYTHON_INSTALL_DIR=/var/lib/mojito/python
UV_CACHE_DIR=/var/lib/mojito/uv-cache
ENV
  chown root:root /var/lib/mojito/agent.env
  chmod 600 /var/lib/mojito/agent.env
fi


echo "setup done: $(uv --version)"
