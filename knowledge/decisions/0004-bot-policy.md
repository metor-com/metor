# 0004 – Bot policy: the box is the sandbox, approvals only at the boundary

**Date:** 2026-08-29 · **Status:** accepted

## Context

Bots run as Claude Code background sessions without a terminal. Every permission prompt stalls the bot
until the user answers it via Remote Control (verified: `researcher` hung on `ls`). The remedy:
the box is the default, not a refusal – nothing is asked inside the computer, approval
cards exist only for the user's machine and external effects.

## Decision

- **Everything allowed inside the box**: `Bash`, `Read`, `Write`, `Edit`, `Glob`, `Grep`, `WebFetch`,
  `WebSearch`, `ListAgents`, `SendMessage`, `Agent`, `TodoWrite` in `permissions.allow`; permission mode
  `acceptEdits`. Deny: the bots' `.claude/` directories and `$CLAUDE_CONFIG_DIR`.
- **Approvals at the boundary**: `isolatePeerMachines: true` (messages to other machines), later the
  user's machine and external effects (sending, paying, publishing).
- **Messages**: `crossSessionInbound: accept`; rules in the profile (sender only, no foreign sessions,
  no fan-out, no ack loops); every outgoing message logged via hook to `/workspace/bus/messages.jsonl`.

## Consequences

Bots work through unattended. The security boundary is the container (file system, processes) plus
the boundary approvals; prompt injection affects at most the shared computer (ADR-0002).
