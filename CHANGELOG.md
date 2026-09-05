# Changelog

All notable user-visible changes to metor are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), versions follow
[Semantic Versioning](https://semver.org/) (the current version is in `VERSION`).

Maintenance rule: whoever finishes a user-visible feature or fix adds one or two lines under
`Unreleased`, written from the user's point of view - technical detail belongs in commits and ADRs.
On a release the section is renamed to the version number and dated. Ideas and open items live in
[BACKLOG.md](BACKLOG.md), decisions in [knowledge/decisions/](knowledge/decisions/README.md).

## [Unreleased]

### Changed

- **The bot list says what a bot is doing, without a status dot**: three pulsing dots under the
  name while it starts, thinks or writes, "waiting for your approval" while an approval card is
  open, and when a bot stops with an error the error itself in red - it also stays in the chat as
  a card with the full text and a Start button. A stopped bot is greyed out in the list and gets a
  Start button in the header; the dot on the picture and the "ready" label in the header are gone.

## [0.2.0] - 2026-09-05

### Added

- **A picture per bot**: every bot shows a picture in the list and the header. By default it is
  one to three initials on a colour - the create dialog fills the initials in from the name as
  you type and picks a colour, both can be changed there - or an image of your own (PNG, JPEG,
  WebP or GIF up to 2 MB) chosen right in the dialog. A click on the picture in the header
  changes all of it later.

- **Gemini CLI as a third runtime** (ADR-0016): bots on Google's Gemini, signed in from the
  create dialog with a Gemini API key from Google AI Studio - the free tier needs no
  subscription; the key is checked once and stays inside the bots' computer. Gemini bots chat,
  use their computer and browser, run routines and send files like the others; connectors from
  Settings apply to them too.

- **The newest models, always**: Claude Code bots can pick **Fable** next to Opus, Sonnet and
  Haiku - each name means the newest model of that family, so the list keeps up with Claude Code
  itself. The names carry the version ("Fable 5.1", "Opus 5"): first from what Claude Code
  reports, then from what the bots' own answers actually ran, which is what counts. Codex bots
  see the models Codex offers right now (asked from Codex, not a fixed list). The create dialog's *Other model id…* (and
  `metor bot create --model`) takes a full model id such as `claude-fable-5-1`.

- **metor on your own Mac**: `metor setup` picks a container runtime (Apple's `container` on an
  Apple silicon Mac with macOS 26, otherwise Docker or Colima), gets the image, starts the bots'
  computer and opens the setup link - no server, no Docker Desktop. The desktop app does the same
  from its connect screen ("Set up the bots' computer on this Mac", with the progress shown live)
  and starts a stopped local bots' computer whenever the app opens. The published image now comes
  for amd64 and arm64.
- **Connect in two steps**: the app first asks where the bots' computer should be - on this Mac or
  on a server, one sentence each - and only then what that needs. On this Mac it acts on its own:
  none yet → set up, stopped → start, running → open, several → pick. A bots' computer that is
  already open in a window never gets a second one: the app jumps to that window.
- **Whose computer**: the interface now always says "the bots' computer" (and "this Mac" for
  your own device) where the two could be confused - the sign-in page, the connect screen, the
  app's menus and the error messages.

- **Desktop app for macOS, Windows and Linux** (`client/desktop`, ADR-0015): the same interface as
  an app of its own - connect with a setup link, a pairing link or a pairing code, several bots'
  computers side by side, native notifications for approvals, finished replies and unexpected
  stops while the app runs, a tray icon, the bot's screen and terminal as before. The app shows
  up under Settings → Devices as "metor app on Mac/Windows/Linux" and can be signed out there.
- **Sign-in for apps and scripts**: the session secret can travel as a bearer token
  (`Authorization: Bearer …`) instead of the cookie; a setup or pairing claim can be redeemed as
  JSON (`POST /bots/api/auth/redeem`); `GET /bots/api/version` tells version and capabilities
  before signing in.

- **Routines next to the chat, in plain words**: a calendar button in the header shows the bot's
  routines as cards - "Weekdays at 07:00", next and last run, active or paused with the reason,
  the task - plus the recent runs; no cron expressions or ids in sight.

- **One computer button instead of three views**: the bot's screen is shown next to the chat
  with a button in the header, and the divider between chat and computer can be dragged (the
  share is remembered per device). On a phone the computer replaces the chat while it is shown.

- **Ticks instead of "delivered"**: sent messages show one tick while on the way, two grey ticks
  once the bot has taken the message and two green ticks once it has answered.

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

- **Messenger header**: the bot list starts with the metor wordmark, the ⋮ menu (Settings) and a
  round + for a new bot, like a messenger; the buttons at the bottom are gone.
- **Settings** replaces the Devices button (now in the ⋮ menu): one dialog with the sections
  **Devices** (sign-in, pairing, notifications), **Appearance** (text size, roles in the bot list)
  and **Behaviour** (bot list sorted by latest activity - newest chat on top like a messenger; the
  view a bot opens with). Appearance also decides when the Claude quota bar shows: always, never,
  or only from a chosen usage (for example 80 %). Appearance and Behaviour are remembered per device.

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
- Routine limits: up to 30 routines per bot, names up to 60 characters, the last 30 runs are kept.
  The routine that pauses itself after many unattended runs is now called "auto-pause".

### Removed

- The old background-session mode (`harness: "claude"`, Claude Code `--bg` with Remote Control and
  the Haiku chat bridge) is gone; every bot now runs through its runtime's host process. Bots that
  were still on the old mode keep their role and files but start a fresh session.

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
