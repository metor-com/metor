# 0018 – The management plane runs apart from the bots

**Date:** 2026-09-06 · **Status:** proposed (planned for 0.3; the quick wins of the same review are
built, see the end)

## Context

Inside the box everything runs as one user, `box` (uid 1000): the supervisor, the gateway, every
bot's host process, the runtime processes the hosts spawn (Claude Code, Codex, Gemini CLI), and
every bot's desktop with its browser. The management's files sit in the shared workspace:
`/workspace/.metor/auth.json` (device sessions and one-time claims), `push.json` (push keys and
subscriptions), `connectors.json` (connector keys and tokens), and every bot's `.metor/inbox.jsonl`
(the turns, interrupts and approval answers a bot's host reads).

A bot works on content it did not write – web pages, mails, documents – and can be steered by
that content (prompt injection). Such a bot can today, with the rights it has anyway:

- run `metor auth link` or write a session hash into `auth.json` and hand the resulting session to
  whoever steers it: a **durable** sign-in to every bot, every terminal, every device setting;
- append an `{"kind":"permission-answer"}` line to its own inbox and thereby **answer its own
  approval card** – the "ask before each use" of a connector is not an independent check;
- read and change the other bots' chats, files and routines, and the connector file with its keys.

The architecture review of 2026-09-06 reproduced the first chain with a copy of the auth module
under one OS user. [ADR-0004](0004-bot-policy.md) accepted "prompt injection affects at most the
shared computer"; the point is that the shared computer includes the management. What this does
**not** change: a steered bot already holds the shell, a browser signed in to the user's sites and
the connector secrets – the loot. What the shared user adds is persistence, the reach across all
bots and devices, and forged approvals. [ADR-0002](0002-box-model.md) kept a harder isolation
possible (the bot id in every path and tool call) without doing it.

## Decision

Three trust zones inside the one box, told apart by OS users; no second container, no container
per bot ([ADR-0002](0002-box-model.md) stands):

| Zone | Runs as | Holds | Reaches the others |
|---|---|---|---|
| Management | `metor` (new user; PID 1 stays `tini` + the supervisor as root, which drops to `metor`) | gateway, hosts, `auth.json`, `push.json`, `connectors.json`, every bot's `.metor/` | writes a bot's inbox, reads its files |
| Execution | `box` | the runtime processes, the desktops and browsers, the runtime logins (`~/.claude`, `~/.codex`, `~/.gemini`) | reads and writes the bot's own files; reads `.metor/chat.jsonl` (its own conversation), writes nothing under `.metor/` |
| Results | files under `/workspace/bots/<name>/` owned by `box` | what the user sees in the file browser | served by the gateway behind the sign-in, pages sandboxed (built 2026-09-06) |

1. **Processes.** The supervisor starts the gateway and the hosts as `metor`; a host spawns its
   runtime child as `box` (`setpriv --reuid=box --regid=box --init-groups`, util-linux, which the
   image has). Desktop chain (Xvnc, window manager, Chromium, ttyd) as `box`. With the runtime no
   longer the same user as the gateway, Chromium can run **with** its sandbox: a seccomp profile in
   `deploy/` that allows user namespaces (as Playwright's image does) replaces `--no-sandbox` in
   `metor-desktop.mjs`.
2. **Files.** `/workspace/.metor/` is `metor:metor` 0700. A bot directory is `box:box`; its
   `.metor/` is `metor:box` 0750 with files 0640 – the runtime may read its history and state,
   never write the inbox, the cursor or the routines file. Existing volumes are migrated once at
   boot (a `chown` pass the supervisor runs when it finds the old layout).
3. **Bot-facing tools speak to the host, not to files.** The routines MCP server (spawned by the
   runtime, so `box`) can no longer write `routines.json`; it talks to its host over a Unix socket
   in the bot's `.metor/` (`metor:box` 0660). The same socket is the seam for the bot bridge of
   [bot-collaboration.md](../design/bot-collaboration.md). `metor bot …` and `metor auth …` on the
   CLI require the `metor` user (or root) – a bot cannot mint a claim, remove a bot or revoke a
   device.
4. **Operator paths.** `docker compose exec box metor auth link` keeps working (the image's `USER`
   becomes `metor`); a runtime sign-in on the terminal becomes `docker compose exec -u box box
   claude auth login`. `metor setup` and the desktop app's local menu pass the user themselves.
5. **Acceptance.** A process with exactly a bot's rights can neither read nor change
   `auth.json`, mint a claim, append to an inbox, answer an approval, read another bot's `.metor/`,
   or call `metor bot` / `metor auth`. The smoke test gets these as negative checks, run as `box`
   inside the container.

Not part of this decision: a user per bot ("trust profiles", see
[ADR-0019](0019-boundary-approvals.md)), or a browser profile per bot – both become possible on
top of this, neither is needed for it.

## Consequences

- The review's acceptance criterion for its S02 holds; a steered bot keeps what it has, gains no
  durable sign-in and cannot forge approvals. Symbolic-link checks in the gateway (built
  2026-09-06) and the Chromium sandbox become meaningful rather than cosmetic.
- Costs: one migration pass over existing volumes at first boot; `-u box` on operator commands
  that address a runtime; the routines server needs the host socket first (step 3 before step 1
  can be enforced); the login probes the gateway runs (`claude auth status` and the like) must run
  as `box`.
- Order of work: (3) host socket for the routines server → (1)+(2) users, ownership, migration →
  seccomp profile and the end of `--no-sandbox` → (4) documentation → (5) negative checks.

## What was built right away (2026-09-06, same review)

Pages and SVGs a bot writes are served with `Content-Security-Policy: sandbox allow-scripts`
(opaque origin: no cookie, no API) and `nosniff`; the file route resolves symbolic links and refuses
targets outside the bot directory or in its dot paths; the connector file is hidden from the file
browser; uploads are created exclusively; sessions expire after a year on the server, revocation
closes open event streams and screen/terminal sockets, and cookie writes must come from the
interface's own origin. The desktop app grants microphone, camera, screen and clipboard to its own
interface only, and both native clients refuse plain http outside the local network.
