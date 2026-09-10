# ADR-0025: Sleep idle runtime processes, retain the bot's computer

Status: accepted, 2026-09-10

## Decision

An enabled bot keeps a lightweight host. Its chosen runtime runs in a separate
worker process group and sleeps after five minutes without work. The host remains
available for the durable inbox and routines; a message or explicit slash-command
discovery starts another worker with the saved session and model settings.

Sleep is decided inside the worker, where the turn queue and pending approvals are
known. Busy/starting states, queued messages, approvals and reported background
tasks prevent it. Reading chat history, status or cached commands does not wake a
sleeping runtime. An open slash menu refreshes its lease. Arrivals during shutdown
stay behind the delivered inbox cursor and wake a replacement worker exactly once.

The worker closes its adapter, then the host cleans up remaining processes in that
worker's process group. Browser and desktop processes have independent groups and
stay alive, including tabs and unsaved page state. Gemini uses the worker's group
when managed so that its CLI wrapper and children cannot survive sleep. A stopped
host does not restart its worker; explicit Pause still disables the bot's routines.

`METOR_RUNTIME_IDLE_SECONDS` defaults to 300; 0 disables automatic sleep. Configure
it on the Space and restart to apply it. A sleeping bot remains available in the UI,
with a Sleeping indicator instead of a Start button.

## Session safeguards and limits

The official runtimes own persistence. A failed resume of a conversation that has
received a turn reports an error and retains the session identifier instead of
silently creating a replacement. An empty native session may have no persisted
rollout yet and receive a new identifier; model/effort preferences still persist.
ACP runtimes that do not advertise session loading do not automatically sleep.
Claude's background-task notifications also block sleep, with its current task
snapshot preferred over individual start/finish events. Work deliberately detached
from the runtime's process group remains outside this lifecycle.

This is process teardown and session resume, not a RAM snapshot. The first response
after sleep has runtime startup latency. Browser memory is not reclaimed here.

## Verification

`runtime-sleep.test.mjs` covers message arrival during shutdown, conversation/model
retention, busy work, approvals, background tasks and disabling sleep. The isolated
`runtime-sleep.integration.mjs` uses real Codex model commands without inference to
check process reclamation, browser/tab preservation and metadata restoration.
Existing demand, command, UI and smoke tests cover compatibility. Full native
conversation persistence uses the runtime resume paths already documented in the
harness facts; no provider credentials are used by the new integration test.
