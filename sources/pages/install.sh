#!/usr/bin/env bash
# Symlink pages into ~/.local/bin. Touches nothing else.
set -euo pipefail
src="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/pages"
dest="$HOME/.local/bin/pages"
command -v uv >/dev/null || { echo "install.sh: uv not found on PATH" >&2; exit 1; }
if [ -e "$dest" ] && [ "$(readlink "$dest")" != "$src" ]; then
  echo "install.sh: $dest exists and is not a link to $src; remove it first" >&2
  exit 1
fi
mkdir -p "$HOME/.local/bin"
ln -sfn "$src" "$dest"
echo "linked $dest -> $src"
: "${MOJITO_SECRETS_DIR:?set MOJITO_SECRETS_DIR (the folder holding pages.env) in your shell profile}"
[ -f "$MOJITO_SECRETS_DIR/pages.env" ] || echo "note: $MOJITO_SECRETS_DIR/pages.env not found yet (hub/deploy/mac-env.sh writes it; on another machine copy it there, chmod 600)"
