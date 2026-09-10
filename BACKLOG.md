# Backlog (as of 2026-09-10)

Priority: top = recommended next. Finished items are removed here and recorded in
[CHANGELOG.md](CHANGELOG.md); large items get an ADR when work starts.
Context and rules: [CLAUDE.md](CLAUDE.md).

## UI polish (improves daily use)

1. **Bot templates** in the create dialog - a small catalogue of roles (researcher, writer,
   watcher with an example routine)
2. Terminal tab: the shell lives per connection (it survives tab and bot switches in the UI, not a
   page reload) - put tmux in between if needed
3. Search the history; make the bot's memory (CLAUDE.md / memory files) visible in the UI
4. Connector follow-ups (ADR-0014 built 2026-09-04): a choice per bot (disabled keys in
   `bot.json`, the `forBot()` seam exists), a `metor connector` CLI, a health check before saving
   (start the server once, list its tools), OAuth for remote servers
5. PWA follow-ups (ADR-0013 built 2026-09-04): remove the ntfy stopgap (`METOR_NTFY_URL`) after
   one release; a per-event choice (approvals only / everything) in the notifications card; the
   badge count on the app icon (Badging API) for the PWA – the phone app has it (ADR-0017)
6. **Working view follow-ups** (the view itself is built, 2026-09-08 – see
   [knowledge/design/working-view.md](knowledge/design/working-view.md)): the folded line could
   name the kinds (*14 steps · web, files*) and a duration; the interface's few translated words
   (steps, typing, the step lines) are the seed of a whole-interface translation, still open;
   a live check of the step lines and the thinking with Gemini CLI and Copilot.

## Routine polish (ADR-0010 "consequences")

- Event triggers (not only schedules)

## Roadmap

- **Connect an existing VPS as a Space** (idea, 2026-09-10) - the user orders a Linux
  server directly from OVHcloud (first test provider) or another host; billing stays with
  the provider. In the desktop app: **New Space → Connect an existing server**, enter its
  IP/hostname and authorize initial access with a password or a metor-generated SSH key.
  No terminal commands or manual SSH session required. A provider-independent installer
  runs over SSH in the background: check OS/resources (initial target: at least 2 vCPUs,
  16 GB RAM and 40 GB disk), install Docker, set up persistent data and HTTPS, start metor,
  and securely pair the Space with the app. Reuse the existing server installer; show
  progress and actionable errors, make retries safe, and preserve data after interruption.
  Verify the server's identity before sending credentials, keep secrets out of logs,
  and remove temporary installation access afterward unless ongoing management is explicitly
  enabled. Start with fresh servers; detect existing workloads and avoid overwriting them.
  Acceptance: a user-ordered OVHcloud VPS becomes a usable Space entirely through the app;
  validate supported Linux versions/architectures, first-connection verification, HTTPS,
  pairing, retry behavior and credential cleanup on a real test server. Automatic provider
  ordering, cloud-init/images and optional ongoing server management are later extensions.

- **Bot collaboration** (next) - Codex and Gemini bots cannot message other bots yet (only
  Claude to Claude via SendMessage). Concept:
  [knowledge/design/bot-collaboration.md](knowledge/design/bot-collaboration.md) - a neutral
  `metor` MCP server for every runtime (stage 1: `list_bots`, `send_to_bot`), then
  assignments with results and files, a ledger and `create_bot` for helper bots (stage 2),
  groups (stage 3, [crew-messaging-groups.md](knowledge/design/crew-messaging-groups.md))
- **Groups ("Teams") + shared memory scopes** - a group is a directory with its own chat.jsonl,
  an orchestrator with hard caps (members/rounds/contributions, see the design draft above),
  Claude and Codex bots in the same chat; memory scopes (user / project / bot) as shared
  knowledge, with the memory backend behind a configurable endpoint
- **Gemini follow-ups** (built 2026-09-05, ADR-0016): verify the ACP update shapes and session
  replay with a signed-in account; record the model the session reports for the labels; an API-key
  field in the wizard; Gemini in the bot-to-bot bridge and in `scripts/smoke.sh`
- **Memory per bot** - measured 2026-09-07 on a Mac: about 550 MB per idle bot (its Chromium with
  renderers, the desktop chain, the host; a Copilot process alone is 290 MB RSS), so six bots froze
  the 4 GB default computer (no swap; `container exec` and the gateway stopped answering, only
  killing the VM helped). Wanted: a guard that warns in Settings → Computer and refuses to start
  more bots than the memory carries, and
  `METOR_MEMORY` in the Mac docs; the local computer now runs with 6 GB. Measured per idle bot:
  desktop about 400 MB (Chromium 306), runtime 150 (Codex) to 265 MB (Claude, Copilot), MCP
  servers 60 MB each (Gemini starts its browser server three times). The Gemini process leak
  found the same day is fixed. Runtime/browser/desktop startup is now on demand (ADR-0024);
  automatic runtime sleep is implemented (ADR-0025); browser eviction and the memory guard remain open.
- **Persistent RAM setting per Space** (2026-09-10, complements the memory guard above) -
  expose **RAM for this Space** in Settings, show the current allocation and host capacity,
  and persist the chosen limit across app launches, Space restarts and updates. For Apple's
  `container`, offer **Apply and restart**: recreate the container with the new memory limit
  and existing data volumes, without rebuilding the image; explain that running bot turns
  are interrupted and preserve bots, chats and sign-ins. For Docker on Linux, increase a
  configured memory limit live where supported and within host capacity. This changes the
  container allocation, not the VPS plan or physical RAM. Validate values and leave enough
  memory for the host; treat reductions separately to avoid killing active workloads.
  Reuse the host wrapper's `METOR_MEMORY` support and define precedence between saved values,
  explicit environment overrides and defaults. Acceptance: a saved increase survives the next
  ordinary start/update, and applying it retains existing Space data.
- **Runtime choice when both are installed** - on a Mac with Docker Desktop and Apple's
  `container`, the host command picks Docker (a stopped Docker cannot say whether it holds the
  computer) and starts Docker Desktop, even while Apple's runtime already runs (seen 2026-09-07
  on a second Mac). Wanted: the app's setup screen offers the choice, or a running Apple runtime
  wins; `~/.config/metor/runtime` or `METOR_RUNTIME=container` is the workaround
- **One image layer per runtime** - today all runtimes sit in one 855 MB npm layer of the image, so a
  bump of a single runtime makes every computer download the whole layer (an update of metor's own
  code is under 1 MB). One `RUN npm install -g` per runtime in `backend/box/Dockerfile` (Playwright
  MCP, Agent SDK, Codex, Gemini, Copilot) shrinks a bump to that runtime's size (Copilot about
  160 MB compressed); `scripts/runtime-versions.mjs` keeps working, the pins move to their own lines
- **Runtime installation on demand** (after the layer split, with an ADR) - the image carries only base, desktop
  and Playwright (about 550 MB compressed instead of 1.4 GB); the registry installs a runtime at its
  first use from npm or claude.ai into its own volume with metor's pinned version, the create dialog
  shows "Install (size)" next to "Sign in"; after an image update metor compares the installed version
  with the pin and reinstalls; the weekly bump then changes pins in the registry instead of the
  Dockerfile. An installed but unused runtime costs no memory, only disk (unpacked: Copilot 302 MB,
  Codex 279 MB, Claude SDK and CLI 459 MB, Gemini 98 MB) - the gain is download and disk for people
  with one runtime; the price: network to npm and claude.ai at run time, half a minute at the first
  bot of a runtime, and an update path that metor has to own
- **Copilot follow-ups** (built 2026-09-07, ADR-0021, facts in
  [copilot-facts.md](knowledge/harness/copilot-facts.md)): verify with a paid plan whether
  `--model` sticks over ACP (with Free it fell back to Auto); the built-in GitHub MCP server as a
  connector in the directory; Copilot in the bot-to-bot bridge; approval cards through
  `session/request_permission` (ADR-0019); attachments as ACP image blocks. ChatGPT headless
  through OpenCode stays an idea (ADR-0011)
- Codex polish: quota display (`account/rateLimits/read`), approval cards via app-server approvals
  (`model/list` is live since 2026-09-05)
- **Claude bots never ask for approval** - observed 2026-09-06: with `permissionMode` `default`
  and `Bash` removed from the allow list, a Claude bot still ran shell commands without a
  permission card (`canUseTool` was not called). Approval cards therefore come only from "ask
  first" connectors (ADR-0014) today; check whether the SDK wiring matches ADR-0004's intent.
  The plan that follows from it: [ADR-0019](knowledge/decisions/0019-boundary-approvals.md) -
  "ask" connectors produce a card in every runtime (Codex approval requests, Gemini
  `session/request_permission`), connectors chosen per bot, trust profiles on top.

## Security (from the architecture review of 2026-09-06; the quick wins are built)

- **Separate the management from the bots** -
  [ADR-0018](knowledge/decisions/0018-management-plane.md): users `metor` and `box`, hosts spawn
  runtimes as `box`, `.metor/` not writable by bots, the routines server over a host socket,
  a migration pass for existing volumes, `-u box` on operator commands. First step: the host
  socket for the routines server. Then a seccomp profile in `deploy/` so Chromium runs with its
  sandbox and `--no-sandbox` leaves `metor-desktop.mjs` (needs the user split to be worth it).
- **Relay: bind the sender's key to the endpoint** -
  [ADR-0020](knowledge/decisions/0020-relay-sender-binding.md), before the first TestFlight round
  with outside testers; negative test in the relay suite.
- Smaller follow-ups from the review: atomic start lock (`wx` instead of read-then-write in
  `metor-lifecycle.mjs`); keep a broken state file for diagnosis instead of treating a parse
  error as empty; `frame-ancestors` and the other security headers without breaking the
  screen/terminal frames; a time zone per routine (today the box's, Europe/Berlin); pin base
  images and GitHub Actions to digests; a stable image channel apart from `main` with the smoke
  test in front of it.
- **Telegram channel** as a thin additional entrance to the gateway (the one OpenClaw gap that
  matters); related idea: an e-mail address per bot as an entrance (delegate by forwarding)
- **Server installation** - built 2026-09-01: ghcr workflow, compose (with or without Caddy),
  install.sh, INSTALL.md. Remaining: npm CLI as a launcher (`npm i -g metor` -> `metor setup`; check npm names), arm64 variant
- **Native clients (ADR-0015)** - desktop app built 2026-09-04 (`client/desktop/`, Electron;
  gateway prerequisites bearer/redeem/CORS/version done). Remaining: signing accounts (Apple
  Developer Program for notarization, a Windows code-signing service) and the first release
  through the `desktop` workflow (tag `desktop-v*`), Homebrew cask + winget manifests (own
  repositories), the microphone permission prompt on macOS (`askForMediaAccess`) once voice
  exists, control of a local computer from the tray (`metor setup`, see "metor on the Mac"),
  a screen-sharing button in the interface (the app already answers `getDisplayMedia`), a
  monochrome template tray icon for macOS. **Phone app** - Capacitor scaffold in `client/mobile/`
  since 2026-09-06 (iOS with SPM, Android, the `window.metor` bridge with bearer on fetch/SSE and
  the session cookie for frames, `metor://` links, local notifications, `mobile` workflow);
  verified in the iOS simulator and the Android emulator: build, pairing by link, session in the
  keychain/keystore, bot list and chat, the bot's screen and terminal in the app's own web view
  (`@capacitor/inappbrowser`; frames inside the page get no session cookie from either WebView, a
  top-level page does – on Android only in the app's process, not the plugin's isolated one).
  Pictures and attachments work since 2026-09-06 (fetched with the token, files open with the
  system viewer – client/mobile/README.md "Pictures and files"); icons, splash screens and the
  TestFlight upload script exist since 2026-09-06 (README "TestFlight": needs the App Store
  Connect app record and an Admin API key); the first TestFlight build went up on 2026-09-06.
  Remaining: an internal Play track with a signing keystore, a QR scanner and Face ID on the
  connect screen, a real-iPhone test of push, the notification tap and the actions
  ([ADR-0017](knowledge/decisions/0017-push-relay.md): relay at push.metor.com; push, the Approve/Deny actions and the notifications switch verified in simulator and emulator), the demo computer for Apple's review. Until the relay
  exists the PWA remains the phone client with push.
- **metor on the Mac** - built 2026-09-05: `metor setup` with Apple's `container` (macOS 26,
  Apple silicon) or Docker/Colima through the same wrapper, multi-arch image workflow, formula
  template, *Bots' computer on this Mac* menu in the desktop app (see
  [knowledge/design/mac-install.md](knowledge/design/mac-install.md)). Remaining: create the tap
  repository `metor-com/homebrew-tap` with the formula and a release sha256; drop the legacy
  6011-6049 port range from the Docker command; phone access to a local computer away from home
  (Cloudflare Tunnel or Tailscale; `metor box update` and the update hint exist since 2026-09-07)
- **Several bots' computers in one app** - built 2026-09-07 (overview with badges, the mailbox
  pattern, [knowledge/design/several-computers.md](knowledge/design/several-computers.md)).
  Remaining: the real-iPhone check of the badge sum and the tap on a push from another computer; a
  warm switch without reloading the interface; "All bots" as the first entry of the overview (one
  list across computers, needs the interface to talk to every computer at once).
- **Whole directories in and out of a bot's directory** (draft, 2026-09-08): download a folder
  as zip or tar and upload a folder as a tar stream through the gateway, from the bot's ⋮ menu,
  the file browser and `metor bot pull|push`, with a transfer strip (progress, cancel) in the
  clients; resume by manifest later. Until then: `container cp` locally, `rsync` + `docker cp`
  on a server. See [knowledge/design/file-transfer.md](knowledge/design/file-transfer.md).
- **Runtimes out of the image** (idea, 2026-09-07): install the runtimes into a volume and offer
  *Update* per runtime under Settings → Computer, against a list of versions metor has tested
  (published with each release), with a way back to the tested version - new models without a
  metor release. Today the weekly `runtimes` workflow proposes bumps as pull requests.
- **Host names without a domain: `<ip-with-dashes>.ip.metor.com`** - our own sslip.io: a tiny
  DNS server (the open-source sslip.io binary or CoreDNS) answering every `<a>-<b>-<c>-<d>.ip.metor.com`
  with the embedded address, the zone delegated from metor.com; the installer then defaults to that
  name when no domain is given, and TLS just works. Prerequisites and open points: an entry in the
  Public Suffix List (otherwise all installations share Let's Encrypt's 50 certificates per week
  under metor.com), a second nameserver at another provider, and the brand question (a dedicated
  zone or a second domain, since anyone can mint `bank.1-2-3-4.ip.metor.com`). The step after that
  is chosen names (`<name>.bots.metor.com`) registered by the installer with a token - tier C, needs
  accounts. Until then INSTALL.md points to sslip.io/nip.io and provider default names.
- Later, tier C (customers): forward_auth, tokens per user, API-key harness
  ([ADR-0005](knowledge/decisions/0005-access.md), [ADR-0006](knowledge/decisions/0006-legal-guardrails.md))

## Operations and hygiene

- Confirm Enter-to-send once with a real keyboard (automation artefact, probably fine); same for
  Enter in the terminal tab
- Supervisor watchdog for functionally dead desktop processes (RFB health check: connects but no
  "RFB" greeting -> restart x11vnc) - the cause on 2026-09-01 was the nofile limit; a health check
  would heal such hangs on its own in future
- Cosmetics: consolidate `.desktop` /
  `.browser` under `.metor`
- SQLite as the next step for chat/inbox JSONL once histories grow large (lesson from comparable
  products); until then a paginated history read (`readHistory` reads the whole file) and
  timeouts on the synchronous runtime probes
