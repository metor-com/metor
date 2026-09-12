# 0035 — Durable local bot collaboration

**Date:** 2026-09-12 · **Status:** accepted

## Context and review of the foundation

All bots in a Space already share a filesystem, a supervisor, persistent inboxes and lightweight
runtime managers. The draft designs described cross-runtime tools, but overstated inbox recovery:
the host advanced its cursor before yielding a turn to the runtime. A crash during work lost that
turn. The uncommitted event foundation also had a delivery-before-receipt gap, receipts limited to
2,048 IDs, uncoordinated rotation and only one previous journal generation. Those mechanisms did
not establish crash-safe fan-out. Its trigger model, MCP routine tools and UI are retained.

## Decision

Use Node's bundled SQLite implementation (Node >=22.13; the box uses Node 22) for a small metadata
ledger at `/workspace/bots/.collaboration/state.sqlite`. WAL, `synchronous=FULL`, an immediate write
transaction and a busy timeout serialize independent hosts, MCP processes, supervisor and gateway.
No new daemon, external queue service, network dependency or provider credentials are introduced.
The existing per-bot `chat.jsonl` and `inbox.jsonl` remain the transport consumed by clients and hosts.

Indexed pending flags ensure supervisor/gateway drains do not load completed ledger payloads into RAM.
The ledger stores assignments, idempotent requests, outbox entries, validated events, frozen
per-routine event deliveries, completed turn IDs, rate/chain counters and notification receipts.
An assignment transition, its event and its outbox entries commit in one transaction. A unique
`request_id` scoped to the sending bot returns the original result on retries; changed arguments
with the same ID are rejected. An assignment is completed only by an explicit report, never merely
because a runtime turn finished. The host records `working` on pickup and `needs_approval` only when
it actually requests user approval. Approval denial records a blockage. Runtime approval support
remains as implemented by each adapter; this change does not invent approvals for auto-allowed tools.

## Delivery and recovery

- A delivery uses the same deterministic ID in the ledger, chat and inbox. Under a Space write
  transaction, the delivery appends and fsyncs chat and inbox, then records its receipt. If the
  process dies before the receipt commits, retry checks the file for that ID, repairs a torn final
  record and completes any missing append. All standard inbox writers use the same write lock.
- The supervisor retries the outbox every second; MCP calls also attempt an immediate drain.
  A missing recipient does not prevent other recipients from receiving their messages. Delivery errors are returned and logged by the supervisor;
  unacknowledged rows remain in the ledger. No failed delivery is silently discarded.
- Hosts persist completion IDs and advance the byte cursor only past a contiguous completed prefix.
  Queued real user turns precede bot/routine turns, retaining FIFO order within each class. Current
  work is not preempted. Out-of-order completion cannot skip a lower-priority pending turn.
- A host stop or runtime crash leaves active work unacknowledged. Replay can repeat model/tool work
  already performed before the crash: **external effects are at-least-once, not exactly-once**.
  An assignment already explicitly reported final is skipped on replay. Completed runtime turns
  are acknowledged even when they did not complete their assignment.
  Assignments left working can be inspected and resumed explicitly by a later user/bot turn.
- Manually paused bots receive durable inbox entries but are never started by collaboration.
  The response says `waiting_for_bot_to_start`. Autostart bots use the existing runtime manager,
  sleep detection and RAM admission; collaboration neither starts browsers nor bypasses admission.
- Event fan-out freezes matching enabled routines on the first drain, including paused bots.
  The stored recipient snapshot survives subsequent routine edits/removal; each pending delivery is
  retried independently. Newly created routines do not consume already planned historical events.
  The callback must use its supplied stable delivery ID in `injectTurn`.
- SQLite WAL checkpointing replaces destructive event-journal rotation. Rows and deduplication
  tombstones are retained; they are not limited to a recent ID window. This trades disk growth for
  reliable replay. A retention/compaction policy is future work, not an implicit expiry promise.
  Recoverable old `.events/events.jsonl[.1]` and receipts are imported once; already overwritten
  generations cannot be recovered. Stop old writers during upgrade. Malformed legacy data fails
  visibly rather than resetting receipts. Keep ledger and inbox files together in Space backups.

## Identity, files and loop limits

The host's runtime configuration supplies the fixed bot name to the stdio `metor` MCP server.
Tool schemas accept no sender, root path, correlation ID, priority or recursion depth. Unknown
arguments are rejected at execution as well as schema level. Built-in metor configuration wins
connector-name collisions. Claude's legacy cross-session ListAgents/SendMessage tools are disabled
in the host so persistent bot communication uses this path. Central instructions also reach old bots.

This is an application identity boundary inside a trusted single-user Space, **not** OS isolation
between bots: existing unrestricted shell/filesystem access under one Unix user can bypass such a
boundary. Strong isolation would require separate users/containers and is outside this decision.

Files are references relative to `/workspace/shared`, not copied snapshots. Hidden paths, absolute
paths, traversal, hard links and symlink escapes (including a replaced shared root) are rejected.
The authenticated chat-file endpoint revalidates shared references when opened. Files can change or
be deleted later. Runtime credentials and other bots' private directories are not reference targets.

Technical limits: 30 new messages/assignments per sender per hour, 12 sends/assignments/event-routine
wakes per correlation chain, 6 message hops and 3 nested assignment levels. A maximum of 32
nonfinal assignment revisions prevents progress-update loops; final results remain possible.
Idempotent retries do not spend the budget again. Results remain durable even when no new work is
admitted. Central instructions prohibit courtesy reply loops and polling for delegated results.

## Visibility and notifications

Chat entries retain origin, sender, assignment ID, state, correlation and file references.
Internal status changes create notices; results/blockages also enter the requester's inbox.
Bot-origin assistant progress is excluded from ordinary finished-turn push notifications.
The gateway claims persisted relevant notifications and calls its existing SSE/native/web/mobile
push path, including the configured push relay. Each assignment has at most one blockage and one
terminal notification; needs-approval uses the existing actionable permission-card notification.

Notification attempts are deliberately **at-most-once**: claim before sending prevents replay spam,
but a gateway crash after claiming or an unavailable relay can lose the push attempt. The durable
chat and assignment state remain available. This is not a guarantee of push delivery, and the
local communication path works without relay connectivity.

## Verification and scope

Automated tests cover concurrent writers, SIGKILL between append and receipt, lost report responses,
fan-out failure/retry, checkpointing, stable IDs, shared paths, identity, loop limits, user priority
across restart, actual stdio MCP configuration, and a two-bot workflow using real host cores and
runtime managers with model doubles (pause → RAM wait → work → result → requester wake).
Existing chat, commands, sleep, memory and approval tests remain regression coverage.
Live model acceptance across signed-in pairs remains separate; doubles cannot prove provider CLI
behaviour or model compliance. No GitHub polling, external producers, groups, helper-bot creation,
new cloud service or deployment is included.

Bot-to-bot result/blockage notifications can be switched off for the whole Space under
**Manage Space → General → Bot-to-bot notifications**. The default is on, including existing
Spaces. The setting persists across restarts and is shared across devices. Muted alerts are
consumed, not replayed when re-enabled. Bot communication, history and actionable approval
notifications are unaffected.
