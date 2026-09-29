# Security

Mojito is **experimental / alpha** software for a single user. Most of its code was written by Claude Code sessions. It hasn't had a security audit. Read this page before connecting your mail, calendar or code, and before turning on the self-rebuild loop.

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting for this repository (**Security → Report a vulnerability**). Don't open a public issue for security problems. Include what you found, how to reproduce it, and what an attacker could do with it.

## What you're trusting

**The maintainer is roughly root on your devices.** It edits code and ships it to your server, your web app, your Android app and your Mac app. Code shipped to the web app or as an over-the-air update runs on your devices and can read the app token stored there. A mistaken or manipulated change can leak or damage your data.

**All three ingredients of prompt injection are present.** Mojito combines:

- **private data:** tasks, notes, plans, calendar, mail metadata, files in your repositories;
- **untrusted content:** email subjects and snippets, calendar invites, paper abstracts, card text, third-party text in screenshots;
- **the ability to act:** the agent changes your data and calendar, and the maintainer changes code and deploys it.

A crafted email or calendar invite could try to steer the agent, or reach the maintainer as "feedback". The defenses listed below reduce this risk; they don't remove it.

**The hub holds everything.** A token has full access for its role. An `app` token can read everything and change most things (every change has an Undo). Treat tokens like passwords.

## What's in place today

- **Tokens per role and per device.** `app`, `worker`, `agent`, `maintainer` and `source:<name>`. Give each device its own app token so you can revoke it alone. The `maintainer` token can read what the app reads, update feedback, reply in feedback threads and send its heartbeat, nothing more.
- **Model calls without tools.** The agent and the worker call `claude -p` with `--tools ""` and `--strict-mcp-config`, and require a JSON-schema-shaped answer. Scripts validate that answer and carry it out. The model never runs commands or opens URLs itself.
- **Read-only local access.** The worker reads only tracked files in git repositories under `MOJITO_PROJECTS_ROOT`, refuses `.env` files, caps file size, and opens Zotero read-only. Strings that look like secrets are redacted from terminal output and email bodies before they reach Claude.
- **No outward actions.** The app never sends, pays, orders or replies on your behalf. Outgoing messages are only drafted for you to send yourself. Calendar events the agent creates are marked and can be undone, and every change an agent makes appears in your timeline with an Undo.
- **Mail stays on your computer.** The Gmail grant is read-only and lives only on the machine that runs the worker. Email bodies are never stored on the hub.
- **A narrow web surface.** `/docs` and `/redoc` are off, `/openapi.json` needs an app token, and the web app under `/app/` is served with a Content Security Policy, `Referrer-Policy: no-referrer` and `X-Content-Type-Options: nosniff`. The reference web deploy script rejects builds that contain source maps or anything that looks like a secret.
- **Hardened services.** The systemd units run as a dedicated `mojito` user with `NoNewPrivileges`, `ProtectSystem=strict`, `ProtectHome` and `PrivateTmp`. The agent is memory-capped so it can't starve the hub.
- **Secrets outside the repository.** Tokens, keys, OAuth grants and signing keys are expected under `~/.config/mojito/` or `/var/lib/mojito/`, and `.gitignore` covers the usual file names as a second line of defense.

## Not in place yet

- **The auto/ask gate is not enforced in code.** Risky changes "ask you first (judged by the maintainer; not yet enforced in code)". The hub accepts any feedback status change from the maintainer token, including `shipped` without your approval, and nothing checks which files a change touched. See [docs/self-rebuild-loop.md](docs/self-rebuild-loop.md#what-the-hub-enforces-today-and-what-it-doesnt).
- **Relayed feedback isn't verified.** Feedback the agent files from chat isn't checked against what you actually wrote.
- **Prompt wording ships automatically.** Changes to the wording of agent and worker prompts are currently in the *auto* column, and prompts shape what the agent does. Moving them to *ask* is part of the planned gate.
- **Over-the-air updates aren't code-signed.** Anyone who controls your Expo account can ship JavaScript to your Android app. Protect that account.
- **The web app's token lives in browser storage.** Any script served from your hub's origin can read it. That's one more reason to give each device its own token.
- **Revoking an app token doesn't unregister Android push.** A revoked Android device can no longer read or change anything, but keeps receiving notification titles until its registration is removed from the hub's `devices` table (with the hub stopped).

## Where your data goes

| Destination | What |
|---|---|
| Your hub | Everything: one SQLite file plus an attachments folder. Backups go wherever you put them. |
| Anthropic, through Claude Code | Whatever the agent, the worker and the maintainer read to do a job: chat, notes, tasks, goals, plans, projects, taste notes, recent cards, the next 7 days of your calendar, email metadata and snippets (and the full text of an email you ask about), files the worker reads from your repositories, and images you attach to chat, notes and feedback. Retention and training use depend on your Anthropic account settings. |
| Google | Your calendar (the ICS feed and any writes), Gmail API reads if you enable them, and FCM for Android push (FCM data messages include the notification title). |
| Web Push services (Apple, Google, Mozilla) | Encrypted notifications. They see when a notification is sent and to which endpoint, not its content. |
| Expo | Your JavaScript bundle, if you use over-the-air updates. |
| arXiv, Hugging Face | Requests for the paper feed. |
| Public Certificate Transparency logs | Your hub's host name, when you use `tailscale serve`, funnel or any public certificate. |
| Mojito's authors | Nothing. There's no telemetry. |

## Hardening checklist

- [ ] Your repository is **private**. You never turned on the loop in a public fork, and you review anything you send upstream for personal details.
- [ ] The hub is reachable only on your tailnet (`tailscale serve`). If you expose it publicly, you've thought about what a leaked token would allow.
- [ ] Each device has its own app token, and you know how to revoke one (SETUP §7).
- [ ] The maintainer runs with Claude Code's permission prompts on, with only your ship commands pre-approved, and never with `--dangerously-skip-permissions`. For extra separation, run it as its own OS user that can read `maintainer.env` but not the rest of `~/.config/mojito/secrets/`.
- [ ] The server's deploy user has no general `sudo`, and SSH is only reachable over the tailnet.
- [ ] You read the diff of any change that adds or updates a dependency, adds a network request or a new domain, or comes from someone else's patch. Those changes will run on a machine that holds your calendar and mail grants.
- [ ] Your Anthropic, Google, Expo, GitHub and Tailscale accounts use two-factor authentication.
- [ ] You know where your secrets are (`tokens.json`, `CLAUDE_CODE_OAUTH_TOKEN`, Google grants, the VAPID key, the Android keystore), and you'd rotate them if you suspected a leak.

## If something goes wrong

- **Lost a device:** remove its app token from the token file and restart the hub. Web Push subscriptions for that token are dropped on restart; for Android, also remove its row from the `devices` table.
- **A token leaked:** rotate all tokens (SETUP §12), then re-enter them on your devices.
- **A bad release:** roll back. For the web app, point `current` at the previous release (the hub picks it up immediately). For the hub or agent, deploy the previous commit. For Android over-the-air updates, republish the previous bundle. Then `git revert` the change.
- **You suspect malicious JavaScript in the web app:** publish a release that contains only an `index.html` and a `sw.js` that calls `self.registration.unregister()`, switch `current` to it, and rotate all tokens.
