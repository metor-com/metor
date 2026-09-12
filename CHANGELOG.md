# Changelog

All notable user-visible changes to metor are recorded here. Versions follow
[Semantic Versioning](https://semver.org/); the current version is in `VERSION`.
Add user-visible changes under `Unreleased`. Ideas belong in `BACKLOG.md` and technical
decisions in `knowledge/decisions/`.

## [Unreleased]

- **Space notification preference:** Manage Space → General can mute bot-to-bot result and blockage notifications across devices. Enabled by default; communication continues and muted alerts are not replayed.

- **Bots work together across runtimes:** Claude, Codex, Gemini and Copilot share the local
  `metor` tools for messaging and assignments. Results, blockages and shared-file links appear
  in chat; important updates use existing client/push notifications. Paused bots keep queued work,
  sleeping bots wake through RAM admission, and user turns take priority over queued bot traffic.
  Durable assignment/event records and stable inbox IDs recover interrupted deliveries without
  claiming exactly-once execution of external actions.

- **Event routine foundation:** routines can use normalized event triggers in addition to cron.
  Event sources write to a durable local journal; matching wakes use the existing bot inbox and
  are deduplicated per bot and routine. The routine tool and panel understand event triggers;
  provider-specific sources follow separately.

- **Portable bots:** export a compressed ZIP with all bot files (or none) and optional conversation context, import into local or remote Spaces, or create an independent copy. Conversations use `conversation.jsonl`, preserving timestamps and restoring visible chat history on import. The export dialog closes after saving. Import has an explicit file picker button and stays responsive while checking a package. Runtime credentials and sessions are excluded; imported bots and routines start paused.

- **Manage server** under Manage Space shows Docker diagnostics and upgrades older official releases to the app version through temporary SSH access, with confirmation and recovery on failed startup.
- **Deployment tests:** opt-in real Docker/Caddy recovery tests and real DNS, TCP and TLS diagnostics tests.

- **More reliable server setup:** interrupted installs retain extra settings and data;
  completed setups reconnect without restarting bots. DNS and HTTPS failures now give
  targeted diagnostics. Sign in with a private SSH key, including encrypted keys, as an
  alternative to the root password; key passphrases are never saved.

- **Set up an existing server** in the desktop app: verify its SSH fingerprint, sign in
  with a root password, review resources, then install metor and connect over HTTPS.
  Passwords are not saved; interrupted app installations can be retried on the same domain.
  First installation and use on Hetzner confirmed by the user. SSH errors distinguish
  rejected credentials, required password changes and connection failures.

## [0.4.0] - 2026-09-11

### Added

- **Bots use resources on demand.** Messages, routines and slash commands load only the
  selected runtime. Browser tools, Screen and Terminal start computer components when needed.
- **Automatic sleep.** Idle runtimes sleep after five minutes and wake for messages,
  routines or commands. Conversations and model settings persist; browser tabs stay open.
- **Space RAM protection.** Runtime, browser, desktop and terminal starts share an admission
  queue with a host-independent Space reserve. Waiting screens retry automatically; Stop
  cancels queued starts. Manage Space shows RAM headroom and pending components.
- **Persistent local RAM allocation.** Choose the new total in GiB under Manage Space.
  Apple containers support increases and reductions with Apply and restart, usage warnings
  and recovery on failure. Data and sign-ins remain on their volumes. Linux Docker supports
  live increases of configured limits; this path has not been verified on a Linux host.
- **Event Log.** Inspect, filter and export bounded diagnostic history, including sleep/wake,
  resource waiting, routine run IDs and processing outcomes, without chat content.
- **Slash-command autocomplete.** Runtime and metor entries have distinct labels and keyboard
  navigation. Session-aware model changes apply between messages; Codex also exposes the
  model's supported reasoning efforts.
- **Adaptive Screen resolution.** Resizing the panel adjusts the bot's desktop once the bot is
  idle. A per-device App settings switch controls this behavior.
- **Screen clipboard support.** Paste local text with Cmd+V/Ctrl+V or Paste, copy selected
  browser text, and synchronize the focused desktop Screen's clipboard. Buttons and manual
  text fields remain available as fallbacks.
- **Working view and document previews.** Fold completed tool steps, view live thinking,
  and open generated documents beside the chat. Thinking is not retained in chat history.
- **Multiple Spaces in native apps.** Switch Spaces without reloading the interface, see
  unread counts across connections and open notifications in the corresponding Space.
- **GitHub Copilot runtime.** Sign in through the official device flow and use Copilot bots
  with chat, files, browser, routines and connectors.

### Changed

- **One Manage Space area** contains the shared Space name, devices, notifications, RAM,
  updates and connectors. Names synchronize across devices. App settings remains separate;
  Remove from my overview removes only the connection on this device.
- **Consistent terminology:** Agent for the technology, Bot for a persistent named instance,
  and Space for the environment in which bots run.
- **Faster local development.** Build/start scripts reuse dependencies, unchanged builds and
  running Spaces. UI-only updates do not restart bots.
- **Runtime and update information** is available in Manage Space. Codex uses its runtime's
  live model catalogue; existing bots keep their selected model.

### Fixed

- Apple container setup installs the recommended Linux kernel without requiring interactive
  input, including after interrupted initialization.
- Gemini process cleanup prevents abandoned processes accumulating after model checks and
  bot restarts.

### Upgrade notes

- Back up persistent volumes before updating. Applying a new Space image interrupts running
  bot tasks; bots, chats, files and sign-ins are retained. Local RAM settings are stored on
  the host and reused by subsequent starts and updates.
- No data migration commands are required. Open browser pages again after updating the
  Space; install the matching desktop build to use the local RAM editor.
- Desktop installers remain unsigned unless the release build is configured for signing.
  Mobile store distribution and Homebrew tap updates are separate release steps.

## [0.3.0] - 2026-09-07

### Added

- **Pause, Resume and Run now on every routine card** - they work without the bot, so a routine
  the quota guard paused can be switched back on when exactly that quota is used up. Creating and
  editing routines stays in the chat.

- **Native phone app for iPhone and Android** (`client/mobile/`,
  [ADR-0017](knowledge/decisions/0017-push-relay.md)): the same interface in a store-ready shell,
  connected to a computer by its setup link, with push notifications through metor's relay -
  Approve / Deny right in the notification, a switch per device, and a badge on the app icon that
  counts unread replies across bots and clears as you read. Bot pictures and picture attachments
  show in the app, and a tap on an attachment or a file in the file browser opens it with the
  phone's viewer (Quick Look on iPhone). A setup or pairing link opened on a phone asks whether
  to sign in the app or the browser. Approve / Deny in a notification applies to the approvals
  that exist today, those of connectors set to ask first. Available to invited testers through
  TestFlight; not in the stores yet.
- **A computer on a Mac can be reached from the phone in the same Wi-Fi**: `METOR_BIND=0.0.0.0`
  at `metor box up` publishes the interface on the network (sign-in by pairing still guards it),
  `METOR_WATCH_BASE` puts the Mac's address into the pairing links.
- **Releases carry the installer**: a version tag becomes a GitHub Release with `install.sh` as
  its asset, and `www.metor.com/install.sh` always points at the latest release.
- **An expired runtime sign-in is repaired in the chat**: when Claude Code answers "Not logged in"
  or "OAuth session expired", or a key is refused, the reply carries the runtime's sign-in right
  there - the same steps as in the create dialog - and a bot that stopped on such an error offers
  it instead of Start.

### Changed

- **The bot list says what a bot is doing, without a status dot**: three pulsing dots under the
  name while it starts, thinks or writes, "waiting for your approval" while an approval card is
  open, and when a bot stops with an error the error itself in red - it also stays in the chat as
  a card with the full text and a Start button. A stopped bot is greyed out in the list and gets a
  Start button in the header; the dot on the picture and the "ready" label in the header are gone.
- **Desktop app: the Computers menu ticks the computer you are looking at** (also in the tray
  menu) and the app remembers it - the next start opens the computer that was open last, whether
  it was chosen from the menu, the connect screen or by focusing its window.

### Security

- **A bot's HTML or SVG file opens sandboxed**: its scripts no longer run with your session and
  cannot call the interface's API. Files the bots write are also served with their real path only
  - a link a bot leaves in its directory cannot lead outside it - and the connector file with its
  keys is no longer listed in the file browser.
- **Sessions end after a year on the server too**, not only in the browser's cookie, and removing
  a device now closes its open screens, terminals and live updates at once. Changes with the
  session cookie must come from the interface's own address (cross-site requests are refused).
- **Desktop app**: microphone, camera, screen sharing and the clipboard are granted to the
  interface itself only; screen sharing needs a click. Desktop and phone app refuse a computer
  address with plain `http://` outside this machine and the local network - the session would
  travel unencrypted.
- The server compose file caps the box at 8 GB (`METOR_MEMORY`) and 4096 processes.

### Fixed

- **Messages sent while the bot was busy survive a restart of its host**: they were lost when the
  host process died before it got to them, although they stood in the chat.
- A routine with a schedule that never matches a date (the 31st of February) is refused instead of
  being given a made-up time; one that runs out of dates pauses with a note.
- Two uploads in the same second no longer overwrite each other.
- The installer's compose file now comes out of the image, so it always carries the volumes the
  image needs (the Gemini login volume was missing from the installer's copy).

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
