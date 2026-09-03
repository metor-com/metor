# 0003 – Build order

**Date:** 2026-08-29 · **Status:** accepted

## Context

The natural dependency chain has about ten build steps (agent → history → messaging → wakes →
priority → groups → memory → sandbox/desktop → permissions → provider).
Claude Code provides identity, transcript, memory, tools, permissions, subagents, cross-session
messaging (Unix socket), scheduling and, with **Remote Control**, the UI (desktop, claude.ai, mobile).
Verified on 2026-08-28/29: `claude --bg --remote-control <name>` runs without a terminal and registers
with Remote Control; `--bg` assigns the session ID itself, `claude agents --json` returns it,
`--bg --resume <id>` continues.

## Principles

1. Vertical slice before breadth – every slice is usable.
2. Build nothing that Claude Code provides.
3. Trust boundary from day 1: bots run inside the computer (Docker), never on the user's machine.
4. Make wakes durable from the start (a restart must not lose queued messages).

## Decision

| # | Slice | Result | Components |
|---|---|---|---|
| 0 ✅ | **Computer + bot manager** | Create bots via CLI, use them in Claude Desktop/mobile; restart-proof | Dockerfile, `metor` CLI (wrapper around `claude --bg --remote-control`), supervisor with `--resume` |
| 1 ✅ | **Harden assignments** | Bot assigns bot; assignment survives restart | `crossSessionInbound`, hook → JSONL log, replay at start |
| 2 ✅ | **Desktop + browser** | Bots browse, user watches | Xvfb, Chrome, Playwright MCP, noVNC, one display per bot |
| 3 | **Routines** | Time- and event-driven tasks | `/loop` in bg sessions, `/schedule` (cloud), later cron → `claude -p --resume` |
| 4 | **Groups + memory scopes** | Bounded meetings, shared knowledge | Hard caps per group (members, rounds, contributions), user/project memory as directories |
| 5 | **Own UI, Codex** | Only once Remote Control becomes the limit | `bot.json` provides for `harness:` from the start |

Deviation from the suggested sequence: steps 1–6 collapse into slices 0–1; **desktop before rooms**,
because the computer is the unique selling point and rooms are the riskiest form of coordination.

## Consequences

No own backend, gateway, protobuf or DB in slices 0–3; `metor` stays a thin wrapper.
Bot = directory `/workspace/bots/<name>/` + Claude Code background session. Permission default
`acceptEdits`. Terms according to [GLOSSARY.md](../GLOSSARY.md).

## Status

- 2026-08-29: Slices 0 and 1 implemented and verified (see [harness/claude-code-facts.md](../harness/claude-code-facts.md)).
  Replay of the bus log at start not built – session resume already carries open assignments forward.
- 2026-08-29: Slice 2 complete: desktop per bot (Xvfb, Chromium, x11vnc, noVNC), Playwright MCP via CDP, watch link with token; external access via Tailscale (ADR-0005), host-side setup open.
