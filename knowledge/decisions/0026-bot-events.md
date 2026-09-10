# ADR-0026: Durable bot event history

Status: accepted, 2026-09-10

## Decision

Store host lifecycle, runtime wake/sleep/error and turn queue/start/outcome records
in each bot's `.metor/events.jsonl`. Each record has an ID and UTC timestamp.
Routine injection allocates a run ID carried through the durable inbox, turn state,
events and routine history. Runtime adapters explicitly report outcomes; idle status
alone is not evidence of successful completion. Persist the active turn so the host
can mark it interrupted after a worker crash or a host restart.

Two generations of at most 2 MiB bound storage. A short filesystem lock coordinates
append, rotation and reads across the gateway, supervisor and host processes. A
stale lock expires after ten seconds. Log failures report to existing process logs
and do not stop bots. This provides operational diagnostics, not transactional or
tamper-proof auditing: abrupt power loss can leave a missing or incomplete record.

The authenticated per-bot events endpoint is read-only. The UI polls only while its
panel is mounted, filters locally and exports all matching retained records. Loading
the log never requests a runtime. Use allowlisted metadata fields; do not duplicate
chat text, tool output or raw provider errors in the export. Detailed errors remain
in host.log. Completed means the runtime turn ended normally, not independent
verification of the requested task.

## Verification

Event tests cover concurrent writers, rotation and excluded sensitive fields. Sleep
tests verify correlated routine queuing/waking/processing/completion and failed or
crashed turns. An isolated browser test checks authentication, no-wake reads, filters,
run correlation, paging, JSONL download and mobile overflow.
