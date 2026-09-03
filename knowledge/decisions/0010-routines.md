# 0010 – Routines: metor MCP tool instead of in-session crons

**Date:** 2026-08-31 · **Status:** accepted (implemented)

## Context

Spike S17 showed: Claude Code's in-session crons (`CronCreate`) carry the core of slice 3 – they fire in
the stream harness and survive restarts via resume. Three limits remained: 7-day self-deletion, Claude
lock-in (Codex/Gemini/OpenCode have no equivalent), and the state lives in the session transcript instead
of the workspace (not visible, not portable). Research on 2026-08-31: there is no protocol standard for
agent scheduling (MCP's Tasks extension concerns long-running tool calls); the de-facto convention is cron
syntax and `add_task`/`list_tasks`/`remove_task` tools. OpenClaw and Hermes schedule
**centrally** (server/scheduler delivers, the agent receives) and persist routines as files with the agent.

## Decision

1. **Own MCP tool `routines`** per bot (`metor-routines-mcp.mjs`, stdio, deliberately without SDK
   dependency; second entry in the bot's own `mcp.json`): `add_task` (name, cron 5 fields box local time,
   prompt), `list_tasks`, `remove_task` – names following the community convention.
2. **State in the workspace:** `.metor/routines.json` (machine-readable) + `.metor/runs.jsonl` (history) –
   survives workspace download, no expiry date, the panel reads the file directly (the transcript parsing
   of the interim solution goes away).
3. **Scheduling authority with the supervisor**: the 30-s tick
   determines due routines (`dueRoutines`) and writes a turn into the inbox – `[Routine "<name>"] <prompt>`,
   marked in the history as `origin:"routine"` (own look in the UI). Missed times are caught up **once** at
   boot (nextRunAt semantics), not stacked. Fires only while the host is running.
4. **Box time zone Europe/Berlin** (`TZ` in the image) – "7 o'clock" is the user's local time.
5. **`CronCreate` is disabled via PreToolUse hook** (`block-cron.sh`): the deny reason explains the right
   tool to the model – verified, the bot quotes the instructions and switches on its own.
6. Mini cron parser in the store (`metor-routines.mjs`): 5 fields, `*`/lists/ranges/steps, dom-OR-dow
   semantics like standard cron; unit-tested.

## Verification (2026-08-31, local)

Bot created a routine via chat assignment through `mcp__routines__add_task` → `routines.json` correct;
fired to the minute (+14 s tick latency) as a `[Routine …]` turn with a reply in local time;
`runs.jsonl` + `lastRunAt`/`nextRunAt` updated; panel shows cron, name, task, last/next run;
CronCreate attempt → hook deny with instructions.

## Consequences

- Slice 3 is thereby complete and **harness-neutral**: a future Codex/Gemini bot only needs MCP –
  delivery and scheduling are metor's job.
- In-session crons remain a documented Claude capability (facts S17) but are not used; old crons
  expire by themselves after ≤7 days.
- Open polish: auto-pause with many unread runs, event triggers
  (not just time), `update_task`/enable-disable.
