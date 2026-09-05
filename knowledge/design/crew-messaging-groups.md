# Design sketch: bot-to-bot messaging (all runtimes) and group chats

Status: **draft, not decided** (2026-09-01) · superseded for messaging, assignments and helper
bots by [bot-collaboration.md](bot-collaboration.md) (2026-09-05); stage B below stays the
reference for groups · becomes an ADR when started · related:
ADR-0011 (multi-harness), ADR-0003 (build order, "Groups").

## Starting point

- Bot↔bot today only works between Claude bots via Claude's cross-session `SendMessage`/
  `ListAgents` (+ PreToolUse hook for the bus log). Codex bots are loners.
- The file IPC (`inbox.jsonl` in, `chat.jsonl` out) is harness-neutral and durable –
  `injectTurn()` already delivers user and routine turns today.
- Group chats need exactly this transport.

## Design principles

1. **One tool to the user, one to colleagues.** A bot answers the user with plain text (as today);
   messages to another bot or to a group go through a dedicated tool – fire-and-forget, with an
   optional `priority` flag that may interrupt the recipient's background work but never a turn
   it is running for the user.
2. **A group is a place, not a bot.** It has its own directory with a definition and its own
   history; members never write into it directly – an **orchestrator** runs rounds and copies each
   member's reply into the group history.
3. **Hard caps, not prompt discipline, prevent loops.** A trigger (user or bot message) starts at
   most a few rounds; each round asks only the bots addressed by name since the last user message
   (nobody addressed → everyone, in turn); a bot with nothing to add returns an empty reply; a round
   without any contribution ends the trigger; a new user message cancels a running round. Prompt
   rules (answer only the sender, no acknowledgement pings, no fan-out without a user instruction)
   complement the caps but are not what makes the system safe.
4. **User first.** Bot-to-bot and group traffic always queues behind the user's own turns.
5. **Durable delivery.** Messages between bots go through the same inbox files as user turns – a
   restart of the computer loses nothing; the supervisor catches up.

## metor design

### Stage A – bridge (small step)

- **New stdio MCP server `metor`** (pattern like `metor-routines-mcp.mjs`, pluggable into every
  runtime) with tools `list_bots` (name, role, runtime, status) and `send_to_bot`
  `{target, text, priority?}`; `target` is `bot:<name>` **or** `group:<name>` from the start
  (stage B builds on it, no rework needed).
- **Delivery:** `injectTurn(target, text, { origin: "bot:<sender>" })` → recipient inbox
  (durable, cursor-based). The recipient's history shows an incoming bubble ("from scout"), the
  sender's history an outgoing one – both sides see the exchange.
- **Rules in the core, not in the prompt:** self-send rejected; only bots of this computer; a
  length limit for the text (host constant, a few thousand characters); optional `priority` →
  `interrupt` into the inbox, but only if the recipient is not currently processing a user turn.
- **The bus log moves into the server** (instead of the PreToolUse hook) – so that Codex messages
  are in the audit too. Then switch Claude bots from `SendMessage`/`ListAgents` to the `metor`
  tools (settings.json allow list, template CLAUDE.md), retire the `log-message.sh` hook.
- **Unify role templates:** the same messaging rule block in CLAUDE.md and AGENTS.md (reply only
  to the sender, no confirmation pings, fan-out only on user instruction, results to `./outbox/`
  if need be).

### Stage B – group chats

- **Group = directory** `/workspace/groups/<name>/` with a definition file (name, member bots,
  created at) and its own `chat.jsonl` in the familiar IPC format (entries carry
  `author: {bot|user}`). The UI shows groups in the sidebar like bots (own section), messages with
  an author badge – ChatView stays largely the same.
- **Caps (first values, tune in practice):** at most 5 bots per group, at most 4 rounds per
  trigger, at most 3 contributions per bot and round, the last 30 entries as context.
- **Orchestrator** in the supervisor/gateway, harness-neutral: user or bot message into the
  group → new trigger (a running round is cancelled) → rounds per the caps above. A member turn =
  `injectTurn` into the member inbox with context `[Group "<name>"] <new messages since your last
  contribution>`; the member's reply (its next assistant text) is taken over into the group
  history by the orchestrator. Open question: cleanly attribute member replies to the group (turn
  correlation via the inbox entry `id` → reply entries until `idle`), so nothing lands twice in
  the private bot history – possibly mark group turns as their own kind in the host core.
- **Mixed runtimes:** Claude and Codex bots (later OpenCode) sit in the same group chat – possible
  because delivery and history are harness-neutral.
- Later: acknowledgement obligation (a bot must visibly reply, otherwise redeliver), reply
  references to earlier entries, cross-user groups (tier C).

## Open decisions

- Tool name/namespace for Claude bots: `mcp__metor__send_to_bot` vs. keeping
  `SendMessage` as an alias (migration of existing bots).
- Priority semantics: only "interrupt on non-user turn" or not at all in stage A.
- Group storage location (`/workspace/groups/` vs. inside `/workspace/bots/`) – the former keeps
  the bot list clean, the latter saves UI special cases.
- How Codex bots get group context (developerInstructions vs. turn prefix).

## Effort (rough)

Stage A ≈ 1 day (MCP server, injectTurn extension, two bubble variants, template alignment,
Claude migration + regression). Stage B ≈ 2–3 days (store, orchestrator, sidebar/chat UI,
turn correlation, tests with mixed runtimes).
