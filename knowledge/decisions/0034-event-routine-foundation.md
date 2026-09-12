# 0034 – Event routines use normalized sources and a durable local journal

**Date:** 2026-09-12 · **Status:** accepted (foundation implemented)

## Context

Routines were cron-only. Polling from a routine can model "tell me when X", but waking a model
on every unchanged check wastes quota. Event sources also differ: some poll, others use webhooks,
sockets, filesystem notifications or internal process events.

## Decision

1. A routine may carry a `trigger`. Existing `cron` remains readable and newly created scheduled
   routines also store `{ "type": "cron", "schedule": ... }` for a gradual migration.
2. Sources normalize input to an envelope with stable `id`, `source`, `type`, occurrence and
   receipt times, structured `subject` and `data`, and an optional polling `cursor`.
3. Normalized events live in the local transactional ledger at
   `/workspace/bots/.collaboration/state.sqlite` (ADR-0035). The supervisor freezes matching
   enabled routines and retains each recipient's delivery independently. Stable inbox IDs close
   the append-before-receipt crash window. WAL checkpointing does not discard pending events.
4. Node process events may notify a source to drain early later, but `EventEmitter` is never the
   reliability boundary. The transactional ledger and bot inbox are.
5. Event payloads are explicitly marked as untrusted external data in the generated turn.

## Consequences

Cron behaviour remains unchanged. Event-routine creation is exposed through `add_event_task` and
the routine panel identifies event triggers, but no provider source ships yet. Internal assignment transitions are the first source (ADR-0035). Provider polling, webhooks and
stream sources remain future work. The earlier uncommitted JSONL rotation and bounded receipts
were replaced after crash-safety review; recoverable legacy rows are imported once.
