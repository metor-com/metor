# 0008 – Own UI (slice 5 pulled forward)

**Date:** 2026-08-30 · **Status:** accepted

## Context

The user wants to create bots, select them, chat with them and see and operate their screen (browser +
terminal) – without claude.ai/code as the dialogue surface. Remote Control has become the limit: the
desktop app never shows container sessions (only claude.ai/mobile), and there is no documented way to
talk to a running `--bg` session from our own UI – except `SendMessage` from another **living** Claude
session. Slice 5 (own UI) is therefore pulled ahead of slices 3/4; ADR-0003 otherwise stays unchanged.

## Decision

1. **Transport UI ↔ gateway**: JSON POST per method + **one** SSE stream with a topic filter
   (`/bots/api/events?topics=agents,chat:<bot>`), keepalive comment every 20 s. No WebSocket (apart from the
   existing noVNC tunnel). Sending only confirms acceptance (`202 {accepted:true}`); states arrive as events.
2. **Chat send path: permanently running bridge session** (user decision: speed over token frugality).
   The gateway keeps a child `claude -p --input-format stream-json --output-format stream-json -n metor-ui
   --model haiku --permission-mode acceptEdits --allowedTools ListAgents,SendMessage` (cwd `/workspace/ui`)
   and writes one user turn to stdin per user message; the model calls `SendMessage` to the target bot
   (verbatim via marker technique). Delivery confirmation mechanically from `tool_use`/`tool_result`
   (`success:true`). Recycling after 50 sends (keep the context small); respawn on exit. Verified in the
   spike on 2026-08-30 (see `harness/claude-code-facts.md`): multi-turn stdin works, warm ≈ 4 s.
3. **Chat receive path: bus-log tail.** The PreToolUse hook logs every outgoing bot message **before**
   delivery (verified – even on failure) to `/workspace/bus/messages.jsonl` (now with an `id` field).
   The gateway tails it with a persisted byte cursor; it recognises bot replies to the UI by the `to`
   prefix `uds:`/`metor-ui` (bots address "the sender" as a socket address). The living bridge prevents
   ENOENT improvisation; the bot template declares delivery errors to `metor-ui` harmless.
4. **History:** gateway-owned append-only `/workspace/bots/<name>/.metor/chat.jsonl`
   (`{id, ts, role, text}` + status lines) – independent of the unverified schema of the session
   transcripts, restart-proof in the volume.
5. **Frontend:** Svelte + Vite, without SvelteKit (ADR-0001 rev.); the gateway serves `frontend/dist`
   statically under `/bots/` (SPA with hash routing, since `/bots/<name>/…` belongs to the noVNC proxy);
   fallback to the old mini page if no build is in the image. Bot names `api` and `assets` are reserved.
   Build as **multi-stage** in the Docker build; the build context is therefore the **repo root**
   (no Node build needed on the VPS).
6. **Terminal = window on the bot desktop** (user decision): xterm in the
   desktop chain (`desktopStart`), visible and operable via the same noVNC; no ttyd, no separate panel.
   `desktopAlive` counts xterm too → the supervisor restores a closed window within 30 s.

## Consequences

- Remote Control (claude.ai/mobile) remains usable in parallel; approvals ("waiting for approval")
  are visible in the UI but for now only resolvable via Remote Control (deliberate gap, referenced in the UI).
- Cost: one small Haiku turn per sent message plus one acknowledgement turn per bot reply.
- The bus log grows without bound → rotation is an open maintenance task.
- Behind Caddy, `/bots*` needs `flush_interval -1`, otherwise the proxy buffers the SSE stream.
- Terms according to GLOSSARY: UI "Bot"/"Computer"/"Chat"/"History"/"Approval", overview "Dock";
  code `agent`/`box`.
