# Glossary

Binding terms for metor. Three vocabularies, deliberately kept apart: **UI** (what users read),
**Code** (identifiers, paths, CLI), **Prompt** (how the system prompt talks to the model).
Rule: code terms do not change when marketing renames things.

## 1. Product and levels

| Term | UI | Code | Prompt | Meaning |
|---|---|---|---|---|
| **metor** | metor | `metor` (CLI, prefix `METOR_*`), `metor bot …` | "a bot of metor" | The brand and this product: an agent platform – delegable bots with their own computer ("metor Bot" until ADR-0007, a two-word product name until 2026-09-02, see the ADR-0007 addendum) |
| **Bot** | Bot, "New bot", "your bots" | `agent`, `agentId`, `agents/<id>/` | "You are *<Name>*, a bot of metor" | A single, persistent instance with name, role, history, memory, desktop |
| **Profile** | Role | `role`, `CLAUDE.md` / `AGENTS.md` | Identity | Stable identity and role of a bot |
| **User** | you | `user` | "the user" | The person who owns the bots; the only party allowed to loosen boundaries |

## 2. Computer and execution

| Term | UI | Code | Prompt | Meaning |
|---|---|---|---|---|
| **Computer** | "Your computer", "metor computer" | `box` (`box/`, `METOR_BOX_*`) | "the box", "your own computer" | The one persistent Linux environment per user in which all bots run (Docker container; possibly a VM later) |
| **Desktop** | Desktop | `display`, `.desktop/` | "your desktop" | Screen + browser window of a bot on the shared computer |
| **Workspace** | Files | `/workspace` | "the workspace" | Shared working directory of all bots |
| **Bot directory** | — | `/workspace/bots/<name>/` | — | A bot's home: role file, `bot.json`, `.metor/` (state, histories), files |
| **Your machine** | "your machine" | `local` | "the user's computer" | The user's real machine – a separate trust zone, reachable only via approvals |
| **Harness / Runtime** | "Runtime" | `harness: claude-stream \| codex` | — | The agent runner that drives the model (Claude Code, Codex) – runs as a process inside the computer; registry in `metor-harness.mjs` (ADR-0011), each bot additionally carries `model` |
| **Connector** | Connector, "Settings → Connectors" | `connector`, `connectors.json`, MCP server key `mcp__<key>__…` | "a tool" | An MCP server configured once in the interface and available to every bot (ADR-0014); the built-in servers `browser` and `routines` are not connectors |
| **Host process** | — | `metor-agent-host`, `.metor/host.pid` | — | One process per bot that drives its runtime (Agent SDK session or `codex app-server`) and speaks the file IPC (ADR-0009, ADR-0011) |
| **Session** | Chat | `session`, `sessionId` | — | Running runtime instance of a bot incl. its context; resumed after a restart |
| **Supervisor** | — | `metor supervise` | — | Process that starts all bots when the computer boots and keeps them alive |

## 3. Collaboration

Bot-to-bot messaging and groups are roadmap items (design draft in
[design/crew-messaging-groups.md](design/crew-messaging-groups.md)); the terms are fixed here so
that code and UI use them consistently once built.

| Term | UI | Code | Prompt | Meaning |
|---|---|---|---|---|
| **Message** | Message | `chat.jsonl` entry `role: assistant` | — | Text from the bot to the user – the bot's visible answer |
| **Assignment** | Assignment to <bot> | `send_to_bot` (planned); today `SendMessage` between Claude bots | "hand a task to a colleague" | Fire-and-forget message between bots; the reply arrives later as a separate turn |
| **Priority** | urgent | `priority` (planned) | "urgent" | Assignment that may interrupt background work of the recipient – never its conversation with the user |
| **Wake** | — | `injectTurn`, prefix `[Routine "<name>"]` / `[Group "<name>"]` (planned) | `[Routine …]` | Turn that starts a bot without the user typing (routine, other bot, group) |
| **Group** | Group | `group` (planned) | "group" | Bounded round of several bots with hard caps on members, rounds and contributions |
| **Subagent** | — | Agent tool (Claude Code), executor (Codex) | — | Helper process started by the bot without its own identity; its result comes back into the bot's turn |

## 4. Memory and rules

| Term | UI | Code | Prompt | Meaning |
|---|---|---|---|---|
| **Memory** | Memory | role file + files in the bot directory | "your memory" | Durable facts outside the session context; the bot maintains them itself |
| **History** | History | `chat.jsonl` (v2 entries) | — | Chronology of all messages, tool lines and approvals of a bot as shown in the UI |
| **Routine** | Routine | `routine`, `.metor/routines.json` | `[Routine …]` | Recurring task (cron schedule) that the bot creates via MCP tools (ADR-0010) |
| **Auto-pause** | paused | `METOR_ROUTINE_GUARD`, `pausedReason` | — | A routine that ran many times without the user looking pauses itself until the user asks |
| **Approval** | Approval | `permission` | — | User decision *allow / deny* for an action the harness asks about |
| **Tool** | — | `tool` | tool | Capability the harness offers the model (shell, read, browser, MCP …) |
| **MCP** | — | `mcp.json`, `metor-routines-mcp.mjs` | MCP | Model Context Protocol – the standard through which metor plugs its own tools (browser, routines) into the harnesses |

## 5. Operation

| Term | UI | Code | Meaning |
|---|---|---|---|
| **Remote Control** | Remote Control | `--remote-control` | Claude Code feature: operate a session from Claude Desktop / claude.ai / mobile. Was the metor UI before the own interface (ADR-0008); no longer used since the background-session mode was removed (2026-09-02) |
| **Channel** | Channel | `channel` (planned) | External chat access (Telegram, e-mail) to a bot |
| **Watch link** | "Watch" | `watchUrl` | noVNC URL (with token) to a bot's desktop; the bot sends it when it needs help in the browser |
| **Device** | Devices | `session`, `/workspace/.metor/auth.json` | A browser signed in by setup link, QR code or pairing code (ADR-0012); listed and revocable in the interface and with `metor auth` |
| **Setup link / pairing code** | "Link a device" | `metor auth link`, `claim` | One-time secrets that turn a browser into a signed-in device: setup link 24 h (first device), pairing link / QR / code 2 min (further devices) |
| **noVNC / VNC / Xvfb** | — | — | Browser-based screen access to a bot's virtual monitor (see ADR-0005) |

## Spelling

- Lowercase, also at the start of a sentence: *metor* (brand and product).
- Instance plain and with an article: *a bot*, *your bots*. Never "metor" for a single instance
  (metor is the platform, a bot is one of your bots).
- In code never `bot` for the instance, always `agent`; never `computer` for the environment, always `box`.
- The bot refers to itself by its name; "of metor" is the origin, not the identity.

Related: [decisions/0002-box-model.md](decisions/0002-box-model.md).
