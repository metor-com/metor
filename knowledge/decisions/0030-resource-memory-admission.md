# ADR-0030: Shared RAM admission for runtime and computer starts

Status: accepted, 2026-09-11

## Decision

Use the cross-process Space memory guard before starting missing browser, desktop
or terminal components. Keep existing processes alive and reuse them. Apply startup
budgets of 512 MiB for a browser, 640 MiB for a full desktop, 128 MiB for desktop
additions to a live browser, and 64 MiB for terminal service, plus the Space reserve.

Identify requests by bot and component kind. Runtime requests retain process lifetime;
resource requests remain valid while the bot is started and its persisted demand exists,
even after a CLI caller exits. A shared FIFO and lease serialize starts. Resource leases
expire after 60 seconds as a failure safeguard and retain a two-second settling interval
after readiness. Stop removes demand and pending requests. Startup does not hold the
per-bot resource lock while waiting for memory: denial returns immediately.

Persist per-component waiting status under .desktop/memory.json and expose it through
bot status and the Space RAM queue. The supervisor retries waiting resources every two
seconds. The gateway returns a no-cache 503 waiting page with Refresh and Retry-After
headers; the browser tool retries admission for up to a minute before reporting waiting.
The underlying persisted demand remains eligible for automatic recovery. Event logs
record component waiting, admission and cancellation without conversation data.

## Limits and verification

This is startup admission, not a hard per-process ceiling or browser eviction. It cannot
prevent later growth in running components. Tests cover resource requests surviving
callers, component identity, shared runtime admission, Stop cancellation, low/unknown
memory and FIFO recovery. Isolated-image checks start real GUI components only after
admission, preserve already-running Chromium, and verify gateway wait/reload/recovery.
The existing runtime-sleep, event and image smoke checks remain required.
