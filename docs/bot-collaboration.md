# Local bot collaboration

Bots in the same Space can delegate work across Claude, Codex, Gemini and Copilot through the
`metor` MCP server. Tell a bot, for example: “Ask the reviewer bot to review this draft and bring
me its findings.” The requester can end its turn while waiting; the result arrives as a new turn.
The chat shows who sent the task, work/approval status, the result or blockage, and shared-file links.

A paused bot keeps the task until you start it. A sleeping bot wakes when RAM admission allows it.
Your pending messages have priority over bot and routine traffic. Running work is not interrupted.

## Tool contract

All mutating tools require `request_id`: a unique string of up to 120 characters chosen for that
operation. Reuse it with exactly the same arguments after a lost response. Reusing it for different
work is an error. Sender identity and correlation are supplied by the host, never tool arguments.

| Tool | Arguments | Result |
|---|---|---|
| `list_bots` | none | `bots`: name, title, role, runtime, status; `sharedDirectory` |
| `send_to_bot` | `to`, `text`, `request_id` | message `id`, `status` (`queued` or `waiting_for_bot_to_start`), `correlationId` |
| `assign_task` | `to`, `goal`, `request_id` | assignment plus initial `delivery` status |
| `get_assignment` | `id` | current assignment; only requester/recipient may read it |
| `report_assignment` | `id`, `status`, `result`, optional `files`, `request_id` | updated assignment; only recipient may report |

`report_assignment.status` is `working`, `blocked`, `completed` or `failed`. `result` is required
except for `working`; `files` is an array of up to 20 paths relative to the Space shared directory.
Message/goal/result text is limited to 16,000 characters. Use a shared file for larger content.

Assignments contain `id`, `requester`, `recipient`, `goal`, `status`, `createdAt`, `updatedAt`,
`correlationId`, `depth`, `revision`, `result` and `files`. The host also records `queued`, `working`
and `needs_approval`. Ending a model turn does not complete an assignment. A blocked assignment
may resume; a completed/failed assignment is final. Start a new assignment for new work.

Example report:

```json
{
  "id": "<assignment ID>",
  "status": "completed",
  "result": "Review complete; two issues need attention.",
  "files": ["reviews/draft.md"],
  "request_id": "review-draft-result-1"
}
```

Create that file under `/workspace/shared/reviews/draft.md` in the default Space layout. The path
references the existing file; it is not a copy or immutable snapshot. Private/hidden paths and links
outside the shared area are rejected. Files and assignments are Space-local; exporting one bot does
not migrate active assignments, the ledger, or shared files. Historical peer names/status are
retained, while old shared-file links are removed so they cannot resolve to unrelated new files. Imported event routines start paused.

## Event routines

The existing `routines.add_event_task` tool can subscribe to internal events, for example:

```json
{
  "name": "Review finished work",
  "source": "metor",
  "event": "assignment.completed",
  "match": {"subject.recipient": "writer"},
  "prompt": "Review the completed assignment if it needs follow-up. Do not send courtesy replies."
}
```

The envelope has `v:1`, stable `id`, `source`, `type`, `occurredAt`, `receivedAt`, object `subject`
and object `data`. Assignment transitions include assignment ID/requester/recipient in `subject`
and status/result/files/correlation in `data`. Matching routines are frozen when the supervisor
first plans an event. Pausing/removing a routine afterward does not revoke its already queued work.

## Reliability and limits

Delivery and status survive restarts. A process can replay an interrupted model turn; already
executed external actions may run again. Stable operation IDs prevent duplicate metor assignments
and results, but do not make external tools exactly-once. Use idempotent external operations too.

The host caps messages (30 per bot/hour), a collaboration chain (12 sends/assignments/event wakes),
hops (6), nested assignments (3), and nonfinal assignment updates (32). Limits return clear errors;
they do not invite another bot to bypass them. Avoid automatic acknowledgement/thanks loops.

Important results and blockages use the normal client/push infrastructure. Push is best-effort:
it needs a reachable relay where configured and is attempted once to prevent replay spam.
Chat and assignment state remain available when a notification is missed.

The durable ledger is `/workspace/bots/.collaboration/state.sqlite` with its SQLite WAL files.
Do not remove it, rotate it as a text log, or restore it independently of the Space inboxes.
Rows/receipts have no automatic expiry yet. See [ADR-0035](../knowledge/decisions/0035-local-bot-collaboration.md)
for recovery semantics, the trusted-Space identity boundary and validation details.

Bot-to-bot result/blockage notifications can be switched off for the whole Space under
**Manage Space → General → Bot-to-bot notifications**. The default is on, including existing
Spaces. The setting persists across restarts and is shared across devices. Muted alerts are
consumed, not replayed when re-enabled. Bot communication, history and actionable approval
notifications are unaffected.
