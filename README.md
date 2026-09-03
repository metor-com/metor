# metor

metor - an agent platform: delegable bots, each with its own computer. A bot has a desktop, a
browser and a terminal inside a shared Linux container, talks to you in a chat, and can run
recurring jobs on its own. Under the
hood each bot is a session of an official coding-agent harness - **Claude Code** or **Codex**,
called "runtimes" in the interface - signed in with your own subscription through the official
login flows.

**Status:** early, working end-to-end, v0.1.0. Expect rough edges; see [BACKLOG.md](BACKLOG.md)
for what is missing and [CHANGELOG.md](CHANGELOG.md) for what is there.

## What you get

- **Chat** with streamed answers (Markdown), collapsible tool lines showing what the bot is doing,
  approval cards (allow / deny) when the harness asks for permission, a stop button for running
  turns, and delivery status per message.
- **Computer panel** next to the chat: the bot's desktop via noVNC (step in for logins, two-factor
  prompts and captchas), a real terminal in the bot's directory, and a file browser with downloads.
- **Attachments both ways**: paperclip, paste a screenshot, or drag and drop files into the chat
  (up to 25 MB, 10 per message); the bot returns files as cards with preview or download.
- **Routines**: tell a bot what should happen regularly and it creates the schedule itself; a panel
  lists the schedules, and a routine nobody looks at pauses itself.
- **Runtime and model per bot**: Claude Code (Opus, Sonnet, Haiku) or Codex (GPT models), chosen
  when the bot is created; the Claude quota is shown in the sidebar.
- **Setup wizard** for a runtime that is not signed in yet: the official Claude Code or Codex login,
  driven from the UI (link plus code, no terminal needed).
- **Sign-in without passwords**: the first browser gets in with a setup link, further phones and
  computers are linked by QR code or pairing code, and every signed-in device can be removed again.
- **Bot-to-bot assignments** (Claude bots) and watch links a bot can send when it needs help.
- **Responsive**: messenger layout on phones, side-by-side chat and screen on desktops.

Details for users: [docs/getting-started.md](docs/getting-started.md).

## Quickstart (local development)

Requires Docker (on macOS, Colima works as a drop-in: `brew install colima docker`, then
`colima start --cpu 4 --memory 8`) and a Claude subscription for the first runtime.

```sh
git clone https://github.com/metor-com/metor.git && cd metor
export PATH="$PWD/backend/harness/bin:$PATH"
metor box build                               # builds the image metor-box:dev
metor box up                                  # starts the container metor-box (volumes: metor-workspace, metor-claude, metor-codex)
metor auth link                               # prints the one-time sign-in link for your browser
```

Open the link, then in the interface click "New bot", sign in to a runtime from the dialog (Claude
Code or Codex, once per box), create a bot, and give it a task. Terminal alternative for the runtime
sign-in: `docker exec -it metor-box claude auth login`. `metor version` prints the version of the
checkout.

For servers (prebuilt image `ghcr.io/metor-com/metor-box`, docker compose, one-line installer,
reverse proxy with login) see [INSTALL.md](INSTALL.md).

## How it works

One container (the "box") per user. Each bot is a directory `/workspace/bots/<name>/` plus a host
process that drives its runtime (an Agent SDK session for Claude Code, `codex app-server` for Codex)
plus its own X display with Chromium. The gateway on port 6010 serves the UI, a JSON API with
server-sent events, and the noVNC and terminal WebSockets. A supervisor brings bots back up after a
restart - with their session context - and fires the routines. Tools that the product adds (browser,
routines) are plugged into the harnesses via MCP.

## Repository layout

```
backend/    box/Dockerfile (the computer image), harness/bin (metor CLI, desktop chain, supervisor,
            gateway, bot hosts, harness registry, routines), harness/hooks, harness/templates (bot instructions)
frontend/   the UI: Svelte + Vite, served by the gateway under /bots/ (built in the Docker multi-stage build)
deploy/     compose.yml, Caddyfile.template, .env.example, install.sh
scripts/    smoke.sh - end-to-end check of a running box (CLI, API, chat roundtrips)
knowledge/  README (index), GLOSSARY (binding terms), decisions/ (ADRs), harness/ (verified facts
            about Claude Code and Codex), design/ (drafts for upcoming work)
docs/       user documentation
```

## Guardrails

- Harnesses run as processes with their official login; never token extraction or API-key
  impersonation of a subscription ([ADR-0004](knowledge/decisions/0004-bot-policy.md),
  [ADR-0006](knowledge/decisions/0006-legal-guardrails.md),
  [subscription rules](knowledge/harness/subscription-auth-rules.md)).
- Inside the box everything is allowed; approvals sit at the boundary - the user's machine and
  actions with external effect ([ADR-0004](knowledge/decisions/0004-bot-policy.md)).
- The bot ID is part of every path and tool call so that harder isolation stays possible later
  ([ADR-0002](knowledge/decisions/0002-box-model.md)).
- No source maps in releases, no silent uploads, no secrets in the repository.
- Terms follow the [glossary](knowledge/GLOSSARY.md): the UI says "bot" and "computer", the code
  says `agent` and `box`.

## Documentation

- [INSTALL.md](INSTALL.md) - server installation and operations
- [docs/getting-started.md](docs/getting-started.md) - using the interface
- [CHANGELOG.md](CHANGELOG.md) - user-visible changes per version
- [BACKLOG.md](BACKLOG.md) - open items and roadmap
- [knowledge/](knowledge/README.md) - glossary, architecture decision records, verified harness facts
- [CLAUDE.md](CLAUDE.md) - working context for coding-agent sessions in this repository
- [CONTRIBUTING.md](CONTRIBUTING.md) - how to contribute (conventions, DCO sign-off)
- [SECURITY.md](SECURITY.md) - supported versions and how to report a vulnerability

## License

Apache-2.0, see [LICENSE](LICENSE) and [NOTICE](NOTICE). The container image bundles third-party
software under its own licenses - including Claude Code and the Claude Agent SDK, which are
proprietary Anthropic software installed from the official channels at build time; see
[THIRD-PARTY.md](THIRD-PARTY.md). Product names of other companies are used only to describe
compatibility or origin.
