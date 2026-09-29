#!/usr/bin/env bash
# Build the iPhone web app (PWA) from a committed ref on your computer and publish it on
# the server under /opt/mojito-web (docs/api.md, iPhone 网页版). Needs MOJITO_SSH_HOST,
# MOJITO_SECRETS_DIR and MOJITO_TIMEZONE (hub/deploy/deploy.env.example). Run from the repo:
#   hub/deploy/deploy-web.sh main "<用户能感知的变化，没有就写：无可见变化>"
# The note's first line becomes the push title "网页版已更新：<first line>", the
# other lines its body. Requires qrencode (brew install qrencode) and node/npm.
set -euo pipefail

REF="$1"
NOTE="$2"
[ -n "$NOTE" ] || { echo "deploy-web.sh: the second argument (user-visible change) is empty" >&2; exit 1; }
command -v qrencode >/dev/null || { echo "deploy-web.sh: qrencode not found (brew install qrencode)" >&2; exit 1; }
HOST="${MOJITO_SSH_HOST:?set MOJITO_SSH_HOST (ssh alias of your server)}"
CARDS_ENV="${MOJITO_SECRETS_DIR:?set MOJITO_SECRETS_DIR (folder holding cards.env)}/cards.env"
: "${MOJITO_TIMEZONE:?set MOJITO_TIMEZONE (compiled into the web bundle)}"
test -r "$CARDS_ENV"
SHA=$(git rev-parse --verify "$REF^{commit}")
BUILD=${SHA:0:12}
PUBLIC_URL=$(grep '^MOJITO_HUB_URL=' "$CARDS_ENV" | cut -d= -f2-)
PUBLIC_URL=${PUBLIC_URL%/}

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

# 1. Clean build from the committed tree only (no local node_modules, .env, keys). The web build
#    carries no over-the-air update settings; its only setting is the timezone.
git archive "$SHA" mobile | tar -x -C "$WORK"
( cd "$WORK/mobile" && npm ci --no-audit --no-fund && \
  EXPO_PUBLIC_MOJITO_TIMEZONE="$MOJITO_TIMEZONE" MOJITO_WEB_BUILD="$BUILD" npm run build:pwa )
OUT="$WORK/mobile/dist-pwa"
test -f "$OUT/index.html"

# 2. Artifact checks: allowed file types only, nothing that looks like a secret or dev leftover.

bad_ext=$(find "$OUT" -type f ! \( -name '*.html' -o -name '*.js' -o -name '*.css' -o -name '*.json' -o -name '*.webmanifest' \
  -o -name '*.png' -o -name '*.jpg' -o -name '*.jpeg' -o -name '*.svg' -o -name '*.ico' -o -name '*.ttf' -o -name '*.otf' \
  -o -name '*.woff' -o -name '*.woff2' \))
[ -z "$bad_ext" ] || { echo "artifact check: file types not allowed:" >&2; echo "$bad_ext" >&2; exit 1; }
bad_name=$(find "$OUT" \( -name '*.map' -o -name '.env*' -o -name 'google-services.json' -o -name '*.keystore' -o -name '*.jks' -o -name '*.apk' \))
[ -z "$bad_name" ] || { echo "artifact check: forbidden files:" >&2; echo "$bad_name" >&2; exit 1; }
for needle in sourceMappingURL EXPO_PUBLIC_ u.expo.dev; do
  if grep -rlF -- "$needle" "$OUT" >/dev/null; then
    echo "artifact check: '$needle' found in:" >&2; grep -rlF -- "$needle" "$OUT" >&2; exit 1
  fi
done
[ "$(python3 -c 'import json, sys; print(json.load(open(sys.argv[1]))["build"])' "$OUT/version.json")" = "$BUILD" ]
echo "artifact checks passed ($(find "$OUT" -type f | wc -l | tr -d ' ') files)"

# 3. Upload into releases/<build>/, carry over the previous release's own hashed
#    bundles (so pages still open on the old version keep loading), then switch
#    atomically. Each release's own static file list is kept in own/<build>.txt so
#    carried-over files are not carried again (the set stays bounded).
REL=/opt/mojito-web/releases/$BUILD
( cd "$OUT" && find _expo/static -type f | sort ) > "$WORK/own.txt"
/usr/bin/ssh "$HOST" "sudo install -d -m 755 $REL /opt/mojito-web/own"
/usr/bin/rsync -a --rsync-path='sudo rsync' "$OUT/" "$HOST:$REL/"
/usr/bin/rsync -a --rsync-path='sudo rsync' "$WORK/own.txt" "$HOST:/opt/mojito-web/own/$BUILD.txt"
/usr/bin/ssh "$HOST" "sudo bash -s $BUILD" <<'REMOTE'
set -euo pipefail
BUILD="$1"
cd /opt/mojito-web
REL=releases/$BUILD
PREV=$(readlink current)
PREV_OWN=own/$(basename "$PREV").txt
if [ "$PREV" != "$REL" ] && [ -s "$PREV_OWN" ]; then
  ( cd "$PREV" && cp -an --parents $(cat "../../$PREV_OWN") "../../$REL/" )
  echo "carried over $(wc -l < "$PREV_OWN") static files from $PREV"
fi
chown -R root:root "$REL"
find "$REL" -type d -exec chmod 755 {} +
find "$REL" -type f -exec chmod 644 {} +
ln -sfn "$REL" current.new
mv -T current.new current
echo "current -> $(readlink current) (was $PREV)"
# Keep the 3 newest releases; never delete the one `current` points to.
ls -1t releases | tail -n +4 | while read -r old; do
  [ "releases/$old" = "$(readlink current)" ] || { rm -rf "releases/$old" "own/$old.txt"; echo "removed releases/$old"; }
done
REMOTE

# 4. Check what the hub now serves.
check() {  # path, expected content-type prefix
  local headers
  headers=$(curl -sS -D - -o /dev/null --max-time 20 "$PUBLIC_URL$1")
  echo "$headers" | head -1 | grep -q ' 200' || { echo "GET $1: $(echo "$headers" | head -1)" >&2; exit 1; }
  echo "$headers" | grep -qiE "^content-type: ($2)" || { echo "GET $1: content-type is not $2" >&2; echo "$headers" >&2; exit 1; }
  echo "$headers" | grep -qi '^content-security-policy: ' || { echo "GET $1: no Content-Security-Policy" >&2; exit 1; }
  echo "GET $1 -> 200 $2 (CSP ok)"
}
check /app/ text/html
check /app/sw.js 'text/javascript|application/javascript'
check /app/pwa-boot.js 'text/javascript|application/javascript'
check /app/manifest.webmanifest 'application/manifest\+json'
served=$(curl -sS --max-time 20 "$PUBLIC_URL/app/version.json" | python3 -c 'import json, sys; print(json.load(sys.stdin)["build"])')
[ "$served" = "$BUILD" ] || { echo "version.json build $served != $BUILD" >&2; exit 1; }
echo "version.json build = $BUILD"

# 5. Tell the user (category release: the title prefix is not one the hub infers).
( set -a; . "$CARDS_ENV"; set +a
  python3 - "$NOTE" <<'PY_EVENT'
import json, os, sys, urllib.request
lines = sys.argv[1].strip().splitlines()
headline, rest = lines[0].strip(), "\n".join(lines[1:]).strip()
body = (rest if rest else headline) + "\niPhone 上回到 Mojito 时会提示刷新。"
event = {"kind": "log", "tier": "digest", "category": "release", "item_id": None, "project_id": None,
         "repo_path": None, "title": "网页版已更新：" + headline, "body": body, "evidence": None}
req = urllib.request.Request(os.environ["MOJITO_HUB_URL"] + "/events", data=json.dumps(event).encode(), method="POST",
                             headers={"Authorization": "Bearer " + os.environ["MOJITO_CARDS_TOKEN"], "Content-Type": "application/json"})
with urllib.request.urlopen(req, timeout=20) as resp:
    print("pushed:", json.load(resp)["title"])
PY_EVENT
)

# 6. Where to open it on the iPhone.
echo
echo "$PUBLIC_URL/app/"
qrencode -t ANSIUTF8 "$PUBLIC_URL/app/"
