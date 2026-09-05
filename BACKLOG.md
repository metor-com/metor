# Backlog (as of 2026-09-04)

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
   badge count on the app icon (Badging API) for open approvals

## Routine polish (ADR-0010 "consequences")

- Event triggers (not only schedules)

## Roadmap

- **Bot-to-bot bridge for all runtimes** (next) - Codex bots cannot message other bots yet
  (only Claude to Claude via SendMessage). Design draft:
  [knowledge/design/crew-messaging-groups.md](knowledge/design/crew-messaging-groups.md)
  (neutral `metor` MCP server, `send_to_bot` with target bot|group, durable via inbox)
- **Groups ("Teams") + shared memory scopes** - a group is a directory with its own chat.jsonl,
  an orchestrator with hard caps (members/rounds/contributions, see the design draft above),
  Claude and Codex bots in the same chat; memory scopes (user / project / bot) as shared
  knowledge, with the memory backend behind a configurable endpoint
- **Gemini follow-ups** (built 2026-09-05, ADR-0016): verify the ACP update shapes and session
  replay with a signed-in account; record the model the session reports for the labels; an API-key
  field in the wizard; Gemini in the bot-to-bot bridge and in `scripts/smoke.sh`
- **OpenCode as fourth runtime** - through the same seam (registry, kind "http" via
  `opencode serve`); subscription paths: GitHub Copilot (official partnership, device flow) and
  ChatGPT headless; Anthropic is not permitted there (see
  [ADR-0011](knowledge/decisions/0011-multi-harness.md))
- Codex polish: quota display (`account/rateLimits/read`), approval cards via app-server approvals
  (`model/list` is live since 2026-09-05)
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
  monochrome template tray icon for macOS. Phones stay the PWA; Capacitor in `client/mobile/`
  only when store presence or background voice demands it (then a push relay, own ADR).
- **metor on the Mac** - built 2026-09-05: `metor setup` with Apple's `container` (macOS 26,
  Apple silicon) or Docker/Colima through the same wrapper, multi-arch image workflow, formula
  template, *Bots' computer on this Mac* menu in the desktop app (see
  [knowledge/design/mac-install.md](knowledge/design/mac-install.md)). Remaining: create the tap
  repository `metor-com/homebrew-tap` with the formula and a release sha256; `metor box update`
  (pull + restart); drop the legacy 6011-6049 port range from the Docker command; phone access to
  a local computer (Cloudflare Tunnel or Tailscale)
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
  products)
