# Changelog

All notable user-visible changes to metor are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), versions follow
[Semantic Versioning](https://semver.org/) (the current version is in `VERSION`).

Maintenance rule: whoever finishes a user-visible feature or fix adds one or two lines under
`Unreleased`, written from the user's point of view - technical detail belongs in commits and ADRs.
On a release the section is renamed to the version number and dated. Ideas and open items live in
[BACKLOG.md](BACKLOG.md), decisions in [knowledge/decisions/](knowledge/decisions/README.md).

## [Unreleased]

### Added

- **Messenger-style bot list**: every bot shows an avatar with its status dot, the time of the
  last message (the time today, "Yesterday", the weekday within a week, otherwise the date), a
  one-line preview of that message ("You: …" for your own) and a badge with the number of unread
  bot messages. Opening a chat marks it read on every device. "Compact bot list" in Settings →
  Appearance switches to one line per bot.

- **Connectors** ([ADR-0014](knowledge/decisions/0014-connectors.md)): under **Settings →
  Connectors** you add MCP servers that every bot can use - from a small directory (Memory,
  Sequential thinking, Context7, DeepWiki, GitHub, Brave Search, Exa, Firecrawl, Hugging Face,
  Stripe) or as a custom connector with a command or a URL, environment variables or headers.
  Both runtimes get them; a connector is live once the bot has (re)started, and one button
  restarts the running bots.

- **Settings** replaces the Devices button at the bottom of the bot list: one dialog with the tabs
  **Devices** (sign-in, pairing, notifications), **Appearance** (text size, roles in the bot list)
  and **Behaviour** (bot list sorted by latest activity - newest chat on top like a messenger; the
  view a bot opens with). Appearance and Behaviour are remembered per device.

- **Free-text bot names**: a bot can be called `Fußball-Späher 2` or `Mein Bot!`. The create
  dialog derives the id (`fussball-spaeher-2` - directory, links, address between bots) live and
  lets you change it; the name is what the sidebar, the header, notifications and the bot's own
  instructions show. CLI: `metor bot create "Mein Bot!" [--id mein-bot]`.

- **Phone app with push notifications** ([ADR-0013](knowledge/decisions/0013-pwa-web-push.md)):
  the interface installs as an app (Android: "Install metor as an app" under Settings → Devices or the
  browser menu; iPhone and iPad: Share → Add to Home Screen, then sign in once inside the app with
  a pairing code). Turned on under **Settings → Devices → Notifications on this device**, it sends a push
  when a bot needs an approval, has finished a reply or stopped unexpectedly – never to the device
  that is looking at that chat. No third-party service in between: the box signs and sends the
  messages itself (needs HTTPS).

- **Claude Code sign-in from the interface**: the "New bot" dialog now runs the official Claude
  login too (open the link, sign in, paste the code the page shows) - no terminal needed. Codex
  keeps its device-code flow.
- **Sign-in without passwords** ([ADR-0012](knowledge/decisions/0012-device-pairing.md)): the
  first browser gets in with a one-time setup link (printed by the installer and by
  `metor auth link`), further phones and computers are linked from a signed-in device by QR code,
  link or pairing code (valid two minutes), and the new **Devices** dialog lists every signed-in
  browser and signs one out. The gateway checks the session on every request, including screen and
  terminal.
- **Unattended installation**: `install.sh` installs Docker by itself when it is missing
  (`METOR_INSTALL_DOCKER=no` stops instead), reads the domain from `METOR_DOMAIN` and the ghcr
  login from `METOR_GHCR_USER`/`METOR_GHCR_TOKEN` when set, and asks only for what is missing -
  one `ssh` line installs a server; it ends with the setup link.

### Changed

- The bundled Caddy configuration no longer carries a login (no user, no password hash, no
  WebSocket exception) - Caddy only terminates TLS; the installer asks for the domain only.

### Removed

- The old background-session mode (`harness: "claude"`, Claude Code `--bg` with Remote Control and
  the Haiku chat bridge) is gone; every bot now runs through its runtime's host process. Bots that
  were still on the old mode keep their role and files but start a fresh session.

### Changed

- Routine limits: up to 30 routines per bot, names up to 60 characters, the last 30 runs are kept.
  The routine that pauses itself after many unattended runs is now called "auto-pause".

### Fixed

- After a restart of the computer a bot could show as "stopped" for a long time although it
  answered (its host mistook a stale process ID for a running twin).

## [0.1.0] - 2026-09-02

First public release. Everything below was built between 2026-08-30 and 2026-09-02.

### Added

**Bots and their computer**

- Computer (the box) with one desktop per bot: virtual display, Chromium, terminal window, noVNC
  access; the desktop has a dock to switch between browser and terminal.
- Bots as persistent sessions with name, role, memory and their own directory. Bots can assign
  tasks to each other (Claude bots) and send watch links (with token) when they need a hand in the
  browser.
- Bots run as Agent SDK sessions ([ADR-0009](knowledge/decisions/0009-stream-harness.md)): the
  chat shows answers, tool activity and clickable approval cards; a restart resumes the session
  **and** its context.
- **Codex as second runtime** ([ADR-0011](knowledge/decisions/0011-multi-harness.md)): bots run on
  Claude Code or Codex (ChatGPT subscription). Runtime and model are chosen when the bot is created
  (also for Claude bots: Opus / Sonnet / Haiku). Codex bots chat, use shell and files, drive their
  own browser, create routines and send files to the chat; restarts keep the context.
- **Setup wizard**: a runtime that is not signed in yet shows the official device-code login in the
  "new bot" dialog (link + one-time code, confirmation on the phone). Login data stays inside the
  box (new volume `metor-codex`). A login failure of one runtime stops only that runtime's bots.

**Interface**

- Own web interface under `/bots/` ([ADR-0008](knowledge/decisions/0008-own-ui.md)): create and
  control bots, chat, watch the desktop (noVNC), Markdown in the chat.
- **Token streaming**: answers type in live (a "writing" bubble with Markdown).
- Stop button for running turns, expandable tool results, quota display (5 hours / week) for the
  Claude subscription in the sidebar, optional ntfy push when a bot waits for an approval.
- **Terminal tab**: a real terminal (ttyd / xterm.js with copy and paste) as a sub-tab of the
  computer panel, per bot, behind the gateway.
- **File browser**: third sub-tab "files" in the computer panel - navigate the bot's directory,
  view and download files (breadcrumb, dot directories hidden).
- **Attachments in the chat**: paperclip, paste screenshots (Cmd/Ctrl+V), drag and drop; chips with
  a remove button above the input, thumbnails in the history. Files are stored under
  `<bot>/uploads/`; the bot reads images itself (runtime-neutral). Max. 25 MB per file, 10 per
  message.
- **Files from the bot**: when the bot writes `[File: path]` in its reply, the file appears as a
  card (image preview or download) inside its message; file paths mentioned in the text are
  offered as cards automatically as well.
- **Responsive interface**: messenger pattern on phones (bot list -> chat with back arrow and back
  gesture), actions in a "more" menu, "side by side" only at desktop width.

**Routines**

- **Routines** ([ADR-0010](knowledge/decisions/0010-routines.md)): bots create their own schedules
  via chat (`add_task` / `list_tasks` / `remove_task`); the supervisor fires them in box local time
  and catches up a missed run once; routines panel in the interface. Runtime-neutral.
- Routine polish: `update_task` (change / pause / resume) and an **auto-pause** - a routine pauses
  after 20 runs without user activity (configurable via `METOR_ROUTINE_GUARD`).

**Installation and operations**

- **Server installation**: prebuilt image on the GitHub Container Registry (built by a GitHub
  Action), `deploy/compose.yml` with or without bundled Caddy (TLS and login), one-line installer
  `curl ... install.sh | sudo bash`, [INSTALL.md](INSTALL.md) with all `.env` options and
  `deploy/.env.example`. Reference deployment behind a Caddy login.
- This changelog.

### Changed

- Mono-repo with `backend/`, `frontend/` and `knowledge/`; product name **metor**
  ([ADR-0007](knowledge/decisions/0007-naming.md)).
- Agent SDK sessions are the default; the previous background-session mode remains as a fallback.
- Bus log rotation.

### Fixed

- Screen and terminal behind the server login: WebSockets failed on Basic Auth (browsers send no
  credentials there) - the gateway now checks a watch cookie instead.
- The screen stayed on "connecting" because x11vnc hung on an absurdly high Docker `nofile` limit;
  the container now runs with 65536.
