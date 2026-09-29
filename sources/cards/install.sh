#!/usr/bin/env bash
# Symlink mojito-card into ~/.local/bin. Touches nothing else.
set -euo pipefail
src="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/mojito-card"
dest="$HOME/.local/bin/mojito-card"
command -v uv >/dev/null || { echo "install.sh: uv not found on PATH" >&2; exit 1; }
mkdir -p "$HOME/.local/bin"
ln -sfn "$src" "$dest"
echo "linked $dest -> $src"
: "${MOJITO_SECRETS_DIR:?set MOJITO_SECRETS_DIR (the folder holding cards.env) in your shell profile}"
[ -f "$MOJITO_SECRETS_DIR/cards.env" ] || echo "note: $MOJITO_SECRETS_DIR/cards.env not found yet (hub/deploy/mac-env.sh writes it)"
