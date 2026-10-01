# Setting up Mojito

This guide takes you from a clone to your own running instance (L1), then shows how to switch on the self-rebuild loop (L2). If you only want to look at the app, the L0 steps in the [README](../README.md#l0-look-around-about-5-minutes-no-accounts) are enough.

Every component reads its configuration from the environment and refuses to start if a value is missing or malformed, naming it. There are no hidden defaults: if something is off, the error tells you which variable to fix.

## 0. Before you start

### Keep your copy private

Don't click **Fork** on GitHub: a fork of a public repository is public, and the loop commits your feedback and personal examples. Clone this repository and push it to a new **private** repository:

```sh
git clone https://github.com/TimeLovercc/mojito.git my-mojito
cd my-mojito
git remote rename origin upstream
git remote add origin <URL of your new, empty, private repository>
git push -u origin main
```

From here on, "your repo" means that private copy.

### What runs where

| Part | Runs on | Needs |
|---|---|---|
| Hub (`hub/`) | An always-on machine | Python 3.12, uv. Hub and agent together fit on a 1 GB machine. |
| Agent (`agent/`) | Same machine as the hub | Claude Code and a Claude token. The service is capped at 450 MB, `claude -p` calls included. |
| Worker (`worker/`) | Your computer | Python 3.12, uv, Claude Code logged in as you |
| Maintainer | Your computer, in your private checkout | Claude Code, Node.js 22 |
| Web app | Built on your computer (4 GB of RAM or more), served by the hub | Node.js 22 |
| Android and Mac apps | Built on your computer | Optional, see sections 8 and 9 |

There are two ways to host the hub and the agent:

- **A. A small Linux server** (for example a 1 GB VPS). Hub and agent run as systemd services under a dedicated `mojito` user. The unit files in `hub/deploy/` and `agent/deploy/` expect the paths in the table below. This is how the reference instance runs.
- **B. One always-on computer** that runs everything. Use the same environment files with paths of your choice, and keep the processes alive with launchd, `systemd --user`, or tmux.

The walkthrough uses layout A. For layout B, swap the paths and run the "foreground" commands.

| What | Layout A path |
|---|---|
| Code on the server | `/opt/mojito` (a checkout of your repo) |
| Hub and agent state and env files | `/var/lib/mojito/` |
| Web app releases | `/opt/mojito-web/releases/<build>/`, with `/opt/mojito-web/current` pointing at the live one |
| Settings for the scripts you run from your computer | `~/.config/mojito/deploy.env`, from [`hub/deploy/deploy.env.example`](../hub/deploy/deploy.env.example): SSH host, hub URL, secrets folder, timezone, contact address |
| Secrets on your computer | `~/.config/mojito/secrets/`, the folder `MOJITO_SECRETS_DIR` points at (`cards.env` and `maintainer.env` live here) |
| Android signing key | `~/.config/mojito/signing/` |

Never put secrets inside the repository. `.gitignore` covers the usual file names, but the safest place is outside the checkout.

**One timezone everywhere.** The hub, the agent, the worker, the app build (`EXPO_PUBLIC_MOJITO_TIMEZONE` in `mobile/.env`) and the Mac app build (`desktop/.env`) each read your IANA timezone, for example `America/Los_Angeles`. They must all use the same one.

### Prerequisites

- **Your computer:** git, Python 3.12 with [uv](https://docs.astral.sh/uv/), Node.js 22 with npm, and [Claude Code](https://docs.anthropic.com/en/docs/claude-code), logged in. The agent and worker call `claude -p` with `--json-schema`, `--input-format stream-json`, `--output-format stream-json`, `--tools ""`, `--strict-mcp-config` and `--no-session-persistence`, so use a current Claude Code 2.x release.
- **Server (layout A):** Linux with systemd, `curl`, `git`, `openssl`, and Python 3 for the one-off snippets below.
- **Recommended:** [Tailscale](https://tailscale.com) on the server and on every device, for private HTTPS.
- **Optional, only for the matching features:** a Google Cloud project (Calendar writes, Gmail), Firebase (Android push), an Expo account (Android over-the-air updates), JDK 17 with the Android SDK and NDK (APK builds), Rust with the Xcode command line tools (Mac app), and the Orca CLI (project snapshots and the maintainer watchdog).

```sh
install -d -m 700 ~/.config/mojito ~/.config/mojito/secrets
```

## 1. Server user and directories (layout A)

```sh
sudo useradd --system --home-dir /var/lib/mojito --shell /usr/sbin/nologin mojito
sudo install -d -o mojito -g mojito -m 700 /var/lib/mojito /var/lib/mojito/attachments
sudo install -d -o mojito -g mojito -m 755 /opt/mojito
sudo install -d -m 755 /opt/mojito-web/releases/init
sudo ln -sfn releases/init /opt/mojito-web/current

# uv for everyone, Claude Code for the mojito user
curl -LsSf https://astral.sh/uv/install.sh | sudo env UV_INSTALL_DIR=/usr/local/bin UV_NO_MODIFY_PATH=1 sh
sudo -u mojito -H bash -c 'cd ~ && curl -fsSL https://claude.ai/install.sh | bash'   # -> /var/lib/mojito/.local/bin/claude

# the code: a checkout of YOUR private repo (a read-only deploy key works well)
sudo -u mojito git clone <URL of your private repository> /opt/mojito
```

### Or let the scripts do it

`hub/deploy/` holds the scripts the reference instance uses to run layout A from your computer over SSH. Fill in [`hub/deploy/deploy.env.example`](../hub/deploy/deploy.env.example), save it as `~/.config/mojito/deploy.env`, load it with `set -a; . ~/.config/mojito/deploy.env; set +a`, and put the secret files it lists into `$MOJITO_SECRETS_DIR`. `install-secrets.sh` needs `claude-oauth-token` (section 5), `ical-url` (section 3.2; without a calendar it holds `file:///var/lib/mojito/empty.ics`, which `setup-server.sh` creates), `ical-extra-urls` (section 3.2; an empty file when you subscribe to no other calendar) and `fcm-service-account.json` (section 3.3, a placeholder works); `google-oauth-calendar.json` is optional. `setup-server.sh` also writes an empty seed to `/var/lib/mojito/seed.json` (section 3.4). Then run, in order:

```sh
ssh "$MOJITO_SSH_HOST" 'sudo bash -s' < hub/deploy/setup-server.sh   # user, directories, env files, bare repo, uv, Claude Code
ssh "$MOJITO_SSH_HOST" 'sudo bash -s' < hub/deploy/gen-tokens.sh     # tokens.json; prints new app and worker tokens once
ssh "$MOJITO_SSH_HOST" 'sudo bash -s' < hub/deploy/gen-vapid.sh      # the Web Push key
hub/deploy/install-secrets.sh                                         # secrets and settings into the server's env files, never printed
hub/deploy/mac-env.sh source:cards MOJITO_CARDS_TOKEN "$MOJITO_SECRETS_DIR/cards.env"
hub/deploy/deploy.sh main "First deploy"                              # push, back up, sync, install the units, restart
```

Read each script before you run it. The rest of this guide explains what they set up, so you can check their work or do it by hand.

## 2. Tokens

The hub authenticates every request with a bearer token, and each token has a role:

| Role | Used by |
|---|---|
| `app` | One device (web app, Android, Mac). Create one per device so you can revoke them one at a time. |
| `worker` | The worker |
| `agent` | The agent |
| `maintainer` | The maintainer session: it can read what the app reads, update feedback, reply in feedback threads and send its heartbeat, nothing else |
| `source:cards` | `mojito-card` and the release scripts' "updated" notifications |
| `source:<name>` | Any other script that reports a heartbeat or posts events |

Create the token file on the hub machine. Tokens must be at least 32 characters of `A-Za-z0-9_-`:

```sh
TOKENS=/var/lib/mojito/tokens.json
sudo python3 - "$TOKENS" <<'PY'
import json, os, secrets, sys
roles = ["app", "worker", "agent", "maintainer", "source:cards"]
fd = os.open(sys.argv[1], os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
with os.fdopen(fd, "w") as f:
    json.dump({secrets.token_urlsafe(32): role for role in roles}, f, indent=2)
print("created", sys.argv[1], "with roles:", ", ".join(roles))
PY
sudo chown mojito:mojito "$TOKENS"
```

To print the token for one role when you need to paste it into an env file or a device:

```sh
sudo python3 -c 'import json, sys; print(next(t for t, r in json.load(open(sys.argv[1])).items() if r == sys.argv[2]))' "$TOKENS" worker
```

The hub reads the token file only at startup. After adding or removing a token, restart the hub.

## 3. The hub

### 3.1 Web Push key (VAPID)

Web Push needs a P-256 private key. The hub never generates one on its own; if the file is missing, it won't start.

```sh
sudo -u mojito openssl ecparam -name prime256v1 -genkey -noout -out /var/lib/mojito/vapid.pem
sudo chmod 600 /var/lib/mojito/vapid.pem
```

Keep this key on the server. If you replace it, every device has to turn push on again.

### 3.2 Calendar (read-only)

The hub fetches one ICS feed every 15 minutes and keeps events from yesterday through the next 14 days.

- **Google Calendar:** Settings → your calendar → *Secret address in iCal format*. Treat that URL like a password.
- **Any other calendar** that publishes an ICS URL works the same way.
- **No calendar:** use an empty local file.

  ```sh
  printf 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//mojito//empty//EN\r\nEND:VCALENDAR\r\n' \
    | sudo -u mojito tee /var/lib/mojito/empty.ics > /dev/null
  # MOJITO_ICAL_URL=file:///var/lib/mojito/empty.ics  (setup-server.sh already creates this file)
  ```

**Subscribed calendars (read-only).** Calendars you only subscribe to, such as a work or school Outlook calendar published as ICS, go in a separate text file, one `https://` or `webcal://` link per line (`webcal` is fetched as `https`, blank lines are ignored). The file is required but may be empty. The hub re-reads it on every fetch, so edits need no restart. Treat the links like passwords: logs and errors name only the host or the line number. Their events show up in Today and in chat with `read_only: true`: the agent won't move or delete them and tells you to change them in the calendar they come from.

```sh
sudo -u mojito install -m 600 /dev/null /var/lib/mojito/ical-extra-urls   # empty: no subscribed calendars
# MOJITO_ICAL_EXTRA_FILE=/var/lib/mojito/ical-extra-urls
```

Writing to the calendar is a separate, optional step for the agent (section 5).

### 3.3 Firebase service account (Android push)

The hub loads a Firebase service-account file at startup.

- **If you'll build the Android app with push:** Firebase console → Project settings → Service accounts → *Generate new private key*. Save it as `/var/lib/mojito/fcm.json`, owned by `mojito`, mode 600.
- **Otherwise:** create a placeholder with a throwaway key. The hub only calls FCM for Android devices that have registered, so the placeholder is never used. Run this on your computer, then copy the file over:

  ```sh
  uv run --no-project --with cryptography python - ~/.config/mojito/secrets/fcm-service-account.json <<'PY'
  import json, os, sys
  from cryptography.hazmat.primitives import serialization
  from cryptography.hazmat.primitives.asymmetric import rsa
  key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
  pem = key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                          serialization.NoEncryption()).decode()
  info = {"type": "service_account", "project_id": "unused", "private_key": pem,
          "client_email": "unused", "token_uri": "https://oauth2.googleapis.com/token"}
  fd = os.open(sys.argv[1], os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
  with os.fdopen(fd, "w") as f:
      json.dump(info, f)
  PY
  scp ~/.config/mojito/secrets/fcm-service-account.json <server>:/tmp/fcm.json
  ssh <server> 'sudo install -o mojito -g mojito -m 600 /tmp/fcm.json /var/lib/mojito/fcm.json && rm /tmp/fcm.json'
  ```

Making FCM optional is on the roadmap.

### 3.4 Seed file

On first start, the hub imports settings and any starting goals, plans and tasks from a seed file. Settings are imported once, when the settings table is empty. Goals, plans and tasks are imported only while the database has no goals. The smallest valid seed:

```sh
sudo -u mojito tee /var/lib/mojito/seed.json > /dev/null <<'JSON'
{
  "settings": {"morning_at": "08:00", "evening_at": "21:30", "evening_enabled": true, "language": "en"},
  "goals": [], "plans": [], "items": [], "records": [], "projects": [], "item_projects": {}
}
JSON
```

- `morning_at` and `evening_at` are local times in `MOJITO_TIMEZONE`. `language` (`en` or `zh`) sets the language of agent replies, notifications and the hub's own texts; the app's interface follows the same setting (switch it later under More). You can change the two times later in the app.
- `hub/deploy/setup-server.sh` writes exactly this file, and `hub/deploy/server.env.example` points at it.
- To see a populated app first, generate the fictional example user Sam with today's dates instead: `python3 examples/demo/demo_data.py seed --day today --timezone <your zone> --language en --app-name Mojito --morning-at 08:00 --evening-at 21:00 --out seed.json`, and copy that file to the path in `MOJITO_SEED`. (`docs/seed.example.json` is the same example with the dates fixed on the day it was generated; it's meant for the mock server.) Decide before the first start: the seed is only read while the database has no goals.
- To start with your own goals and a first two-week plan, fill in `goals`, `plans` and `items` using the shapes of Goal, Plan and Item in [`docs/api.md`](api.md). Otherwise start empty and add things through notes and chat.
- Keep the file where it is: `MOJITO_SEED` is required on every start.

### 3.5 Environment file

Start from [`hub/deploy/server.env.example`](../hub/deploy/server.env.example) and save it as `/var/lib/mojito/env` (owner root, mode 600; systemd reads it as root). For layout B, keep it outside the repo, for example at `~/.config/mojito/secrets/hub.env`. Write plain `KEY=value` lines with absolute paths, no quotes and no spaces in values (`deploy.sh` splits the file into arguments for its preflight check).

| Variable | Meaning |
|---|---|
| `MOJITO_DB` | SQLite file. Tables are created on first start. |
| `MOJITO_TOKENS` | The token file from section 2 |
| `MOJITO_SEED` | The seed file from section 3.4 |
| `MOJITO_ICAL_URL` | The calendar feed from section 3.2 (`https://…` or `file://…`) |
| `MOJITO_ICAL_EXTRA_FILE` | The subscribed-calendar link file from section 3.2 (may be empty) |
| `MOJITO_FCM_CREDENTIALS` | The service-account file from section 3.3 |
| `MOJITO_ATTACHMENTS_DIR` | Directory for images attached to chat, notes and feedback. It must already exist and be writable by the hub. |
| `MOJITO_VAPID_KEY_FILE` | The key from section 3.1 |
| `MOJITO_VAPID_SUBJECT` | Contact for push services: `https://<your hub>` or `mailto:<address>` |
| `MOJITO_PUBLIC_URL` | The hub's HTTPS address, `https://<host>` with no path and no trailing slash. It's only used to build links in notifications, so you can fill it in after section 4. |
| `MOJITO_WEB_DIR` | The `current` symlink from section 1. The hub resolves it on every request, so switching releases needs no restart. |
| `MOJITO_TIMEZONE` | Your IANA timezone, for example `Europe/Lisbon`. Day boundaries, schedules and times in messages use it. The agent and the worker must use the same value. |
| `MOJITO_OWNER_NAME`, `MOJITO_CONTACT_EMAIL` | Shown on the hub's public pages `/` and `/privacy`. Google asks for a homepage and a privacy policy when you publish an OAuth app. Use a name (no spaces, a handle works) and an address you're happy to have public. |
| `UV_PROJECT_ENVIRONMENT`, `UV_PYTHON_INSTALL_DIR`, `UV_CACHE_DIR` | Where uv keeps the hub's virtualenv, Python and cache (under `/var/lib/mojito`, because the service can't write anywhere else) |

### 3.6 Start it

Layout A (systemd):

```sh
sudo -u mojito env $(sudo grep '^UV_' /var/lib/mojito/env | xargs) \
  /usr/local/bin/uv sync --frozen --project /opt/mojito/hub
sudo install -m 644 /opt/mojito/hub/deploy/mojito-hub.service /etc/systemd/system/mojito-hub.service
sudo systemctl daemon-reload
sudo systemctl enable --now mojito-hub
journalctl -u mojito-hub -f
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8787/today   # 401 means it's up and wants a token
```

Layout B (foreground):

```sh
cd hub
uv sync
set -a; . ~/.config/mojito/secrets/hub.env; set +a
uv run uvicorn mojito_hub.main:app --host 127.0.0.1 --port 8787
```

Always run a single process; never add `--workers`. The watchdog runs inside the hub process, and one SQLite connection owns the database.

## 4. HTTPS

The Android and Mac apps only talk to a hub over HTTPS (plain HTTP is allowed for `localhost` during development), and browsers only allow Web Push and home-screen installs on HTTPS pages.

**Recommended: Tailscale Serve** keeps the hub inside your tailnet.

```sh
sudo tailscale serve --bg 8787
tailscale serve status          # shows https://<machine>.<tailnet>.ts.net
```

Turn on MagicDNS and HTTPS certificates in the Tailscale admin console first. Put the address in `MOJITO_PUBLIC_URL` and restart the hub. Every device then needs Tailscale switched on to reach the hub. Push still arrives without it, because the hub sends it out through the push services.

Things to know:

- The certificate is logged in public Certificate Transparency logs, so the machine name becomes public. Pick a neutral name.
- The Mac app only connects to `*.ts.net` addresses and `localhost` unless you edit `desktop/src-tauri/capabilities/default.json`.
- Alternatives: `tailscale funnel --bg 8787` (reachable from the whole internet), Cloudflare Tunnel, or a reverse proxy such as Caddy on your own domain. With any public entry point, your tokens are the only lock, so revoke them when a device goes missing.

## 5. The agent

The agent handles chat replies, the morning brief, the evening question and calendar writes, one job at a time.

1. **Claude token.** On a computer where Claude Code is logged in, run `claude setup-token` and keep the output as `CLAUDE_CODE_OAUTH_TOKEN`. Treat it like a password. Check that running Claude Code headless on your own server fits the terms of your plan.
2. **Google Calendar writes (optional).**
   1. In Google Cloud, create a project, enable the Google Calendar API, configure the OAuth consent screen, and create an OAuth client of type *Desktop app*. Download its JSON to `~/.config/mojito/secrets/google-client.json`.
   2. Authorize on your computer. This prints a URL to open in a browser that's signed in to the calendar's account:

      ```sh
      uv run hub/deploy/google-auth.py --client ~/.config/mojito/secrets/google-client.json \
        --scope calendar --out ~/.config/mojito/secrets/google-oauth-calendar.json
      ```

   3. Copy the output to the server as `/var/lib/mojito/google-oauth.json` (owner `mojito`, mode 600).

   While the consent screen is in *Testing* mode, Google expires refresh tokens after 7 days. Publishing the app avoids that; unverified apps show a warning on the consent screen, which is fine for your own use. The hub's `/` and `/privacy` pages exist for the consent screen's homepage and privacy links.

   Without this step, still set `MOJITO_GOOGLE_OAUTH` to that path. The agent runs normally, calendar writes are unavailable, and **System** shows *Google Calendar (write)* as not connected.
3. **Environment.** Copy [`agent/.env.example`](../agent/.env.example) to `/var/lib/mojito/agent.env` (root, mode 600; layout B: `~/.config/mojito/secrets/agent.env`) and fill it in. `MOJITO_TIMEZONE` must match the hub's.
4. **Start it.**

   ```sh
   sudo -u mojito env $(sudo grep '^UV_' /var/lib/mojito/agent.env | xargs) \
     /usr/local/bin/uv sync --frozen --no-dev --project /opt/mojito/agent
   sudo install -m 644 /opt/mojito/agent/deploy/mojito-agent.service /etc/systemd/system/mojito-agent.service
   sudo systemctl daemon-reload
   sudo systemctl enable --now mojito-agent
   journalctl -u mojito-agent -f
   ```

   The unit caps the agent, including its `claude -p` child processes, at 450 MB and makes it the first thing the kernel kills when memory runs out, so the hub survives on a 1 GB machine.

   Layout B: `cd agent && uv sync && set -a && . ~/.config/mojito/secrets/agent.env && set +a && uv run mojito-agent`.

Once the app is connected (section 7), send a chat message; a reply should arrive within seconds.

## 6. The worker

The worker runs on your computer and uses your own Claude Code login. It turns notes into tasks, refreshes next steps, drafts plan reviews and weekly summaries, runs the feeds, and answers chat questions that need local data. Everything it reads locally is read-only.

1. **Environment.** `cp worker/.env.example worker/.env && chmod 600 worker/.env`, then fill it in:

   | Variable | Meaning |
   |---|---|
   | `MOJITO_HUB_URL` | The hub's HTTPS address |
   | `MOJITO_WORKER_TOKEN` | The `worker` token |
   | `MOJITO_CLAUDE_BIN` | Absolute path of `claude` (`command -v claude`) |
   | `MOJITO_TIMEZONE` | Same value as the hub's |
   | `MOJITO_PROJECTS_ROOT` | A folder containing git repositories the worker may read: tracked files only, `.env` files refused, 20 KB per file |
   | `MOJITO_GMAIL_OAUTH_FILE` | Gmail authorization (below). The file may be absent; mail features then show as not connected. |
   | `MOJITO_ZOTERO_DB` | Path to `zotero.sqlite` (opened read-only) for the paper feed's taste signals, or `none` |
   | `MOJITO_ARXIV_CATEGORIES` | Comma-separated arXiv categories for the paper feed, for example `cs.AI,cs.HC` |

2. **Run it.** In the foreground: `cd worker && uv sync && uv run mojito-worker`. On macOS, `worker/launchd/install.sh` renders a LaunchAgent for this checkout and loads it (logs in `~/Library/Logs/mojito-worker.log`; see `worker/README.md` to unload it). On Linux, write a `systemd --user` unit that runs the same command in `worker/`.
3. **Gmail (optional, read-only).** Create a second *Desktop app* OAuth client with the Gmail API enabled, then:

   ```sh
   uv run hub/deploy/google-auth.py --client ~/.config/mojito/secrets/google-client-desktop.json \
     --scope gmail --out ~/.config/mojito/secrets/google-oauth-gmail.json
   ```

   This grant stays on your computer: never copy it to the server. `gmail.readonly` is a restricted scope, so an unverified app shows a warning. Email bodies are never sent to the hub; the daily mail card carries sender, subject and one line per message.
4. **Feeds.** New instances start with three subscriptions. The daily AI brief: papers from arXiv and Hugging Face daily papers, picked with your taste notes, the cards you asked about and optionally your Zotero library, plus web news (Google News search, no account needed). The lab watch: news about a list of AI labs every 8 hours; edit the list by telling chat ("also watch Mistral"). And the daily mail digest. Turn off what you don't use in **Feed → Subscriptions**, otherwise **System** will show it failing.
5. **Orca (optional).** Project snapshots and the maintainer watchdog use the `orca` CLI. Without Orca, **System** shows project sync as failing; everything else works.

Before restarting the worker, check that no job is mid-flight: `GET /jobs?status=running` with an app token should return an empty list. An interrupted job goes back to the queue after 30 minutes.

## 7. The web app (PWA)

The web app is the main way to use Mojito on a phone, and the only one on iPhone. The hub serves it at `/app/`, from the same origin as the API, so it needs no extra network configuration.

Build it on your computer. The web build never uses over-the-air updates, and your timezone is compiled into it:

```sh
cd mobile
npm ci
BUILD=$(git rev-parse HEAD | cut -c1-12)
MOJITO_OTA=none EXPO_PUBLIC_MOJITO_TIMEZONE=America/Los_Angeles MOJITO_WEB_BUILD=$BUILD npm run build:pwa   # output: mobile/dist-pwa/
```

Publish it (layout A):

```sh
rsync -a dist-pwa/ <server>:/tmp/web-$BUILD/
ssh <server> "sudo mv /tmp/web-$BUILD /opt/mojito-web/releases/$BUILD \
  && sudo chown -R root:root /opt/mojito-web/releases/$BUILD \
  && cd /opt/mojito-web && sudo ln -sfn releases/$BUILD current.new && sudo mv -T current.new current"
```

Layout B: copy `dist-pwa/` into `<web dir>/releases/$BUILD/` and point the `current` symlink at it with `ln -sfn`.

With `deploy.env` loaded, `hub/deploy/deploy-web.sh main "<note>"` does the full version of this for layout A. It builds from a committed ref in a clean temporary directory, rejects artifacts that contain source maps or anything that looks like a secret, keeps the previous release's static files so pages that are already open don't break, keeps the last three releases, and sends an "updated" notification.

Install it on a device:

1. Open `https://<your hub>/app/`.
2. Paste an `app` token. Give each device its own token (add one to the token file, restart the hub).
3. On iPhone: Share → *Add to Home Screen*, then open it from the home screen. iOS only allows Web Push for home-screen web apps. On Android and desktop browsers, use the browser's install option.
4. In the app, **System → Notifications** → turn on push.

To revoke a device, remove its token from the token file and restart the hub. On startup, the hub deletes the Web Push subscriptions of tokens that no longer exist.

## 8. Android app (advanced)

The Android app adds home-screen widgets, FCM push with inline reply, and over-the-air updates. You build and sign it yourself; see [`mobile/README.md`](../mobile/README.md) for the details.

- **Settings.** `cp mobile/.env.example mobile/.env` and fill it in: your timezone (`EXPO_PUBLIC_MOJITO_TIMEZONE`), over-the-air updates (`MOJITO_OTA=none`, or `eas` with `MOJITO_EAS_OWNER` and `MOJITO_EAS_PROJECT_ID`), and, for release builds, the paths of your Firebase config, signing properties, APK output folder and secrets folder. All of them live outside the repo.
- **App id.** `mobile/app.json` ships with `com.example.mojito`. Change it before your first build: an installed app can only be updated by an APK with the same id and signing key.
- **Toolchain.** JDK 17 and the Android SDK command-line tools with platform 36, build-tools 36.0.0, NDK 27.1 and CMake 3.22.1.
- **Firebase.** Add an Android app with your app id to a Firebase project, save its `google-services.json` outside the repo (mode 600) and set `MOJITO_GOOGLE_SERVICES_JSON` to it. The build copies it in and fails without it. The hub needs the same project's service account (section 3.3).
- **Signing key.** Create a keystore once and back it up offline. Without it, you can't update the installed app.

  ```sh
  install -d -m 700 ~/.config/mojito/signing
  keytool -genkeypair -v -keystore ~/.config/mojito/signing/mojito-release.keystore \
    -alias mojito -keyalg RSA -keysize 2048 -validity 10000
  ```

  Then write `~/.config/mojito/signing/signing.properties` (mode 600) with `storeFile`, `storePassword`, `keyAlias` and `keyPassword`, and set `MOJITO_SIGNING_PROPERTIES` to it.
- **Build.** `npm run build:apk -- --message "<one line>" --notes "<change 1>;<change 2>"`. The script also posts a "new build" notification, so set up `cards.env` first (section 11).
- **Over-the-air updates (optional).** Run `npx eas-cli login` and `npx eas-cli init` to create your own EAS project, set `MOJITO_OTA=eas` with its owner and project id, then build one APK. With `MOJITO_OTA=none`, every change needs a new APK. After that, JavaScript-only changes ship with `npm run update -- --message "…" --notes "…"`. The runtime version is a fingerprint of the native code, so an update is only delivered to APKs it's compatible with; native changes always need a new APK.
- **Connect.** In the app, open **System → More**, then enter the hub URL and an `app` token.

## 9. Mac app (advanced)

The Mac app is a Tauri 2 shell around the web build, with a menu-bar panel, notifications and a Dock badge. It isn't signed by Apple: open it the first time with right-click → *Open*. It stores the hub URL and token in the macOS Keychain. Copy `desktop/.env.example` to `desktop/.env` and set your timezone; releases also need your secrets folder and a self-signed code-signing certificate. See [`desktop/README.md`](../desktop/README.md) for building and releasing it.

```sh
cd mobile && npm install
cd ../desktop && npm install
npm run build      # a local build
```

## 10. The maintainer (L2)

1. Copy [`docs/maintainer.env.example`](maintainer.env.example) to `~/.config/mojito/secrets/maintainer.env` (mode 600) and fill in the hub URL and the `maintainer` token. With `deploy.env` loaded, `hub/deploy/mac-env.sh maintainer MOJITO_MAINTAINER_TOKEN "$MOJITO_SECRETS_DIR/maintainer.env"` writes it for you without printing the token.
2. Write down how *your* instance ships (server address, paths, which of the commands above you use) in a file outside the repo, for example `~/.config/mojito/ship.md`.
3. Start Claude Code in your private checkout and point it at `docs/maintainer.md` and your ship notes.

The details, including permissions, cost and what to expect, are in [self-rebuild-loop.md](self-rebuild-loop.md).

## 11. Cards from any Claude Code session

`mojito-card` lets any session post a result to your feed: a finished experiment report, a relevant paper, an idea worth reading on your phone.

```sh
sources/cards/install.sh      # symlinks ~/.local/bin/mojito-card
cp sources/cards/cards.env.example ~/.config/mojito/secrets/cards.env && chmod 600 ~/.config/mojito/secrets/cards.env
export MOJITO_SECRETS_DIR=~/.config/mojito/secrets    # mojito-card reads $MOJITO_SECRETS_DIR/cards.env; put this in your shell profile
mojito-card --project none --kind report --title "Benchmark finished" \
  --summary "Two sentences: what came out and why it's worth a look." --origin my-script
```

The release scripts use the same `cards.env` to post "updated" notifications. See [`sources/cards/README.md`](../sources/cards/README.md).

## 12. Running it day to day

- **Logs:** `journalctl -u mojito-hub -f`, `journalctl -u mojito-agent -f`, and the worker's log.
- **Backups:** `MOJITO_DB=<db> uv run python -m mojito_hub.snapshot <output file>` (run in `hub/` with the hub's uv environment) writes a consistent, integrity-checked copy while the hub runs. Also copy the attachments directory. `hub/deploy/mac/` has a launchd job that pulls a nightly snapshot to a Mac for layout A.
- **Restarts:** a restart interrupts running jobs, and an interrupted job is re-queued after 30 minutes. Restart when `GET /jobs?status=running` is empty.
- **Rotating tokens:** create a new token file (section 2), restart the hub and the agent, update `worker/.env`, `maintainer.env` and `cards.env`, and paste the new app tokens into your devices.
- **Updating from upstream:** your instance will have drifted from this repository, since that's the point. Fetch `upstream`, and treat merging it like an *ask* change: have the maintainer do it and ask you whenever a conflict touches `docs/design.md`, `docs/api.md` or the data model.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| A process exits at start with `KeyError: 'MOJITO_…'` or `missing env [...]` | That variable isn't set in its env file |
| `npm run web` or `npm run mock` stops at `EXPO_PUBLIC_MOJITO_TIMEZONE` | Copy `mobile/.env.example` to `mobile/.env` |
| The hub exits with `MOJITO_PUBLIC_URL … must be https://<host>` | Use `https://`, no path, no trailing slash |
| The hub exits with `MOJITO_WEB_DIR … is not a directory` | Create the release directory and the `current` symlink (section 1) |
| The app says the token is invalid | The token isn't in the token file, or the hub hasn't been restarted since you added it |
| The app shows "data from <time>" | It can't reach the hub and is showing its cache. Is Tailscale on? |
| **System** shows an authorization as broken | Re-run the matching `google-auth.py` step, or `claude setup-token` for the agent, then restart the agent or worker |
| Morning brief didn't come | The hub was down at that time (reminders aren't sent late), or the brief had nothing to say |
