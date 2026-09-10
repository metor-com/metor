# ADR-0024: Start bot components on demand

Status: accepted, 2026-09-10

Runtime idle eviction is added by [ADR-0025](0025-runtime-sleep.md); browser and desktop retention remain unchanged.

## Context

An idle bot previously started its runtime and complete graphical computer. Browser
processes accounted for much of the memory usage even for text-only work. Gateway
startup also discovered models by launching every installed runtime.

## Decision

Keep one lightweight host per enabled bot. It watches the durable inbox but loads
its selected runtime adapter only when a message or routine arrives, or when the
user opens slash autocomplete. Reading chat history, files, status and command
capabilities does not wake the runtime. Explicit command discovery uses POST.
The supervisor continues to deliver routines to these hosts without depending on
a browser, desktop or active runtime session.

Keep independent Chromium profiles per bot. A small stdio bridge passes through
Playwright MCP initialization and tool discovery; before a tool call it ensures
that the bot's browser is running. This uses the installed Playwright server's own
schemas and protocol. A browser requires the X display and window manager. Opening
Screen adds the dock, desktop terminal and noVNC proxy; opening the Terminal tab
starts only ttyd. A bot can explicitly request its GUI using
`metor bot computer <name> desktop` before shell-based screen automation.

Component requests and Stop are serialized per bot with an atomic file lock.
The supervisor repairs only requested components. Requests are cleared on Stop
and Space restart. Browser profiles, chats, runtime sessions and model preferences
stay on disk. The first subsequent turn resumes the runtime's saved session.
Model/setup discovery in the create dialog runs only for the selected runtime.

## Consequences

The first use takes longer than subsequent uses. Once loaded, components remain
available until Stop or Space restart: this change does not automatically evict
idle runtimes or discard open browser tabs. All runtimes remain installed in the
image; installation on demand is a separate download/disk optimization. There is
no shared-browser isolation change and no VM checkpointing.

Verification: `demand-core.test.mjs`, `demand.integration.mjs`, runtime command and
effort integration tests, and `scripts/smoke.sh --no-chat` in an isolated Space.
