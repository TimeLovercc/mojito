#!/usr/bin/env bash
# Ensure /var/lib/mojito/tokens.json has one random 32-byte token per role, and
# write the agent token into /var/lib/mojito/agent.env. Existing tokens are kept;
# only missing roles get new ones. Extra `source:<name>` roles (one per external data source that
# posts heartbeats or events) are passed as arguments. Run from your computer:
#   ssh "$MOJITO_SSH_HOST" 'sudo bash -s' < hub/deploy/gen-tokens.sh
#   ssh "$MOJITO_SSH_HOST" 'sudo bash -s source:nas-backup' < hub/deploy/gen-tokens.sh
# Prints newly created app/worker tokens once; agent goes to agent.env, the rest
# are fetched onto the Mac with mac-env.sh (never printed).
# Only list roles the deployed hub accepts: an unknown role makes the hub fail to start.
# To rotate everything: sudo rm /var/lib/mojito/tokens.json, re-run, restart services.
set -euo pipefail

umask 077
python3 - /var/lib/mojito/tokens.json /var/lib/mojito/agent.env "$@" <<'PY'
import json, os, secrets, sys

tokens_path, agent_env_path, extra_roles = sys.argv[1], sys.argv[2], sys.argv[3:]
for role in extra_roles:
    if not role.startswith("source:") or role == "source:":
        sys.exit(f"extra role {role!r} must be source:<name>")
roles = ["app", "worker", "agent", "source:cards", "maintainer", *extra_roles]

tokens = {}
if os.path.exists(tokens_path):
    with open(tokens_path) as f:
        tokens = json.load(f)
have = set(tokens.values())
for role in roles:
    if role in have:
        continue
    token = secrets.token_urlsafe(32)
    tokens[token] = role
    if role == "agent":
        print("agent: created (written to agent.env)")
    elif role in ("app", "worker"):
        print(f"{role}: {token}")
    else:
        print(f"{role}: created (write it to the Mac with mac-env.sh)")
with open(tokens_path, "w") as f:
    json.dump(tokens, f, indent=2)

agent_token = next(t for t, r in tokens.items() if r == "agent")
with open(agent_env_path) as f:
    lines = [l for l in f.read().splitlines() if not l.startswith("MOJITO_AGENT_TOKEN=")]
lines.append(f"MOJITO_AGENT_TOKEN={agent_token}")
with open(agent_env_path, "w") as f:
    f.write("\n".join(lines) + "\n")
PY
chown mojito:mojito /var/lib/mojito/tokens.json
chmod 600 /var/lib/mojito/tokens.json /var/lib/mojito/agent.env
