# 0002 – Computer model: one computer (`box`) per user

Terms: see [GLOSSARY.md](../GLOSSARY.md) – UI "Computer", code `box`.

**Date:** 2026-08-28 · **Status:** accepted, revision planned

## Context

The model: **one** persistent Linux environment per user; each bot only gets its own display/browser
window on it, while file system, tools and browser logins are shared – the bots of one user work
like colleagues at one machine. The alternative "one container per bot"
isolates harder, but costs:

- **Communication:** handing files between bots needs shared volumes or APIs instead of a path.
- **Setup/teardown:** per bot a container + Xvfb + Chrome (seconds, ~0.5–1 GB RAM) instead of a display + directory.
- **Subscriptions:** `~/.claude`/`~/.codex` would have to be mounted/copied into every container;
  rate limits are per account anyway – isolation gains nothing here.
- **Browser logins:** would have to be repeated per bot – the opposite of the product promise.

## Decision

metor bot starts **like the original**: one box per user, per-bot displays, shared file system
and shared login state. Harnesses (`claude`, `codex`) run inside the box and are logged in once.

To keep a later move to harder isolation possible:

1. Bot ID in every tool call and every path (`agents/<botId>/…`), never implicit from the process.
2. Chrome profile per bot as an option (directory parameter), default = shared.
3. The app ↔ harness ↔ box protocol does not assume a shared file tree between harness and box.

## Consequences

Fast start, simple bot communication, one set of logins. Security boundary = box per user;
prompt injection in one bot reaches all of the user's bots. **Revision** as soon as multi-tenancy
or highly exposed bots (web/e-mail) are added – then selectively (e.g. a quarantine profile for
browsing bots) rather than across the board.

## Addendum 2026-08-29

The container is the boundary for file system, processes and shell – **not** for messages: Claude Code
sessions under the same account see and reach each other across machines via Remote Control
(verified, see [harness/claude-code-facts.md](../harness/claude-code-facts.md)). Bots therefore get
messaging rules in their profile; a mechanical sender allow-list follows in slice 1.
