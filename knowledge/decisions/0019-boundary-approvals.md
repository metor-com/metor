# 0019 – Boundary approvals are connector approvals: for every runtime, chosen per bot

**Date:** 2026-09-06 · **Status:** proposed (the wording in README, INSTALL and the user guide is
already aligned; the rest follows [ADR-0018](0018-management-plane.md) or runs alongside it)

## Context

[ADR-0004](0004-bot-policy.md): inside the box everything is allowed, approvals sit at the
boundary – the user's machine and actions with external effect. What exists today:

- The host core has `askPermission()`: an approval card in the chat, a push to the phone, the
  answer from the inbox. Claude Code reaches it through the SDK's `canUseTool`, which fires for
  connector tools not in `allowedTools` – and for nothing else: a Claude bot with `Bash` outside the
  allow list still ran shell commands without a card (observed 2026-09-06, BACKLOG).
- A connector can be marked **Ask before each use** ([ADR-0014](0014-connectors.md)). That reaches
  Claude Code bots only: the Codex adapter runs `approvalPolicy: "never"` with
  `danger-full-access` and answers any server request with "approved"; the Gemini adapter runs
  `--approval-mode yolo` and picks the allow option of every `session/request_permission`.
- Every enabled connector reaches every bot; `forBot()` is the seam for a choice per bot.

The website spoke of sending, paying and publishing behind approvals. The review of 2026-09-06
called it what it is: mostly intent. A shell command or a browser click can send, upload or change
an account with no gate in between, and a user who connects a sensitive account may rely on a
protection that is not there.

## Decision

1. **Say what asks.** Inside the computer nothing asks – not the shell, not the browser, not the
   files. Approval cards exist for connectors marked "ask", today for Claude Code bots. README,
   INSTALL.md and the user guide say so as of 2026-09-06; the website follows.
2. **The boundary is the connector.** Sensitive accounts (mail, calendar, payments, publishing)
   reach a bot through a connector, not through a browser sign-in, when the user wants a card. An
   "ask" connector produces a card for every call in every runtime, through the one
   `askPermission()`:
   - Claude Code: `canUseTool` as today.
   - Codex: the app-server's approval request for a tool call – to verify which policy makes MCP
     calls ask (`approvalPolicy: "on-request"` scoped to the connector's tools, else the adapter
     answers the server request from the card instead of "approved").
   - Gemini: `session/request_permission` – when the tool belongs to an "ask" connector, the
     adapter routes it to `askPermission()` instead of picking allow.
3. **Connectors per bot.** `bot.json` names the connectors a bot gets (default: every enabled one,
   as now); the connector card in the interface gets a per-bot choice; `forBot()` filters.
4. **Trust profiles later.** A plain choice when creating a bot – *public research* (no
   connectors), *with my accounts* (connectors, "ask" by default) – is the user-facing form of 2
   and 3, worth having once [ADR-0018](0018-management-plane.md) makes the separation real.
5. **Unknown runtime requests** stay allowed inside the box and logged (ADR-0004); once 2 exists,
   anything that names an "ask" connector goes to the card.
6. **Not done:** classifying shell commands or browser actions by their effect. It is not
   enforceable – every gate has a `curl` around it – and the reason for ADR-0004 stands: a bot that
   hangs on `ls` is no bot.

## Consequences

- The promise matches the product: a capability table per runtime in the user guide (what asks,
  what does not), kept with the adapters.
- The review's test matrix becomes smoke checks per runtime once 2 is built: a call to an "ask"
  connector produces a card and waits; an answer from the inbox that no card asked for is ignored
  (needs [ADR-0018](0018-management-plane.md) to be more than a check of the host's own logic).
- Users keep full autonomy where they want it: a bot without "ask" connectors is a fully
  autonomous bot, and is called that.
