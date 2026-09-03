# 0009 – stream harness: bots as their own harness sessions

**Date:** 2026-08-31 · **Status:** accepted

## Context

Slice 5 (ADR-0008) shows only SendMessage content in the chat: no assistant text, no tool activity,
approvals resolvable only via claude.ai. The user wants the presentation and interactivity of Claude
Desktop inside metor ("variant 2"). Remote Control cannot be tapped (no API); the documented way is
to run the session ourselves: `claude -p`/Agent SDK ("harness as a process", policy-compliant per
`harness/subscription-auth-rules.md`). Spikes S10–S13 (2026-08-31, container, SDK 0.3.251) confirmed
all prerequisites – see `harness/claude-code-facts.md`.

## Decision

1. **New harness mode `claude-stream`** (default for new bots; user decision: migrate all bots).
   Per bot a host process `metor-agent-host.mjs` runs (child of the supervisor, PID/state under
   `.metor/host.pid` + `.metor/harness.json`) that drives the session via `@anthropic-ai/claude-agent-sdk`
   with **streaming input**: `settingSources` user/project/local (loads CLAUDE.md + hooks), `systemPrompt`
   preset `claude_code`, `permissionMode acceptEdits`, `extraArgs {name, mcp-config}` (session stays
   addressable by name for bot↔bot), `resume` with the remembered sessionId.
2. **IPC via files** (restart-proof, like the bus log): gateway → host via `.metor/inbox.jsonl`
   (user messages, approval answers); host → gateway via `.metor/chat.jsonl` (tail). No socket, no
   second protocol.
3. **chat.jsonl becomes the shared history format** of both modes, extended by `kind`: `text`
   (assistant text = reply to the user), `tool` (tool call, UI line like "Uses N tools"), `permission`
   (approval card) – plus `{type:"patch", ref}` for subsequent state changes (analogous to the existing
   `{type:"status", ref}`). `readHistory` (metor-chat-stream.mjs) reads via passthrough; extra fields
   survive reloads.
4. **Approvals**: the `canUseTool` callback parks without deadline, writes a `permission` card and waits
   for the answer from the UI (`POST /bots/api/agents/<name>/chat/permission`). Inside the box almost
   everything stays allowed (ADR-0004); the callback only kicks in at the boundary.
5. **`--bg` mode (`harness:"claude"`) stays in the code as a fallback** (bridge + bus tail, Remote Control).
   Migration of existing bots: stop, switch `harness`, remove the old roster session; stream mode starts
   with a fresh context (old histories remain viewable in claude.ai).
6. **Consequences for the UI**: replies are the direct assistant text (template `CLAUDE-stream.md`: no
   SendMessage to the user); tool lines and approval cards in the chat; status busy/idle from
   `harness.json`. For stream bots, claude.ai/mobile is **no longer** a parallel second UI.

## Verified foundations (spike, see claude-code-facts.md)

- SDK streaming session: multi-turn via AsyncIterable, turn ≈ 2–5 s, `interrupt()`/`close()`.
- **Resume keeps session ID AND context** (no fork semantics as with `--bg --resume`).
- Incoming SendMessage from other sessions reaches the idle SDK session as its own turn;
  addressing by name (`extraArgs {name}`).
- `canUseTool` fires for non-allowed tools, may wait indefinitely ("no park deadline");
  bare `allowedTools` entries and settings allow rules shadow the callback (intended).

## Consequences / open points

- The gateway/supervisor is now a real harness server (process lifecycle per bot).
- No token streaming in v1 (file IPC); tool activity + text arrive immediately, partials are
  follow-up work (`includePartialMessages` + own live channel).
- Bus log/bridge remain only for `harness:"claude"`; rotation still open.
- The SDK version is coupled to the CLI version (0.3.251 ↔ 2.1.251) and pinned in the Dockerfile.

## Addendum 2026-09-02: fallback removed

The `--bg` fallback (`harness:"claude"`, Remote Control, Haiku chat bridge `metor-chat.mjs`,
`/workspace/ui` bridge directory, roster polling via `claude agents --json`) was removed after two
days without a bot depending on it; the last two bots on it were switched to `claude-stream` in
place (role and files kept, new session). The bus log stays as an audit trail of bot-to-bot
`SendMessage` calls (hook `log-message.sh`) until the neutral bridge in the roadmap replaces it.
