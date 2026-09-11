# Architecture Decision Records

Format: `NNNN-short-title.md` with sections **Context · Decision · Consequences · Status · Date**.

| No. | Title | Status |
|---|---|---|
| 0001 | [Repo structure](0001-repo-structure.md) | revised 2026-08-30 (mono-repo) |
| 0002 | [Computer model: one computer (`box`) per user](0002-box-model.md) | accepted, revision planned |
| 0003 | [Build order](0003-build-order.md) | accepted |
| 0004 | [Bot policy: the box is the sandbox](0004-bot-policy.md) | accepted |
| 0005 | [Access: Tailscale now, relay for the product](0005-access.md) | accepted |
| 0006 | [Legal guardrails: subscriptions and third-party material](0006-legal-guardrails.md) | accepted |
| 0007 | [Naming: product, memory system, organisation](0007-naming.md) | accepted; addendum 2026-09-02: product name shortened to **metor** |
| 0008 | [Own UI (slice 5 pulled forward)](0008-own-ui.md) | accepted |
| 0009 | [stream harness: bots as their own harness sessions](0009-stream-harness.md) | accepted |
| 0010 | [Routines: metor MCP tool instead of in-session crons](0010-routines.md) | accepted (implemented) |
| 0011 | [Multi-harness: registry, one host entry point, Codex via app-server](0011-multi-harness.md) | accepted (2026-09-01) |
| 0012 | [Sign-in by device pairing instead of passwords](0012-device-pairing.md) | accepted (2026-09-03, implemented) |
| 0013 | [Installable interface (PWA) with Web Push, no push relay](0013-pwa-web-push.md) | accepted (2026-09-04, implemented) |
| 0014 | [Connectors: MCP servers configured once, for every bot](0014-connectors.md) | accepted (2026-09-04, implemented) |
| 0015 | [Native clients: Electron on the desktop, PWA on phones, one `client/` directory](0015-native-clients.md) | accepted (2026-09-04, desktop app implemented) |
| 0016 | [Gemini CLI as the third runtime, signed in over its agent protocol](0016-gemini-runtime.md) | accepted (2026-09-05, implemented; turn shapes to verify) |
| 0017 | [Push relay: native push for the phone app through a forwarder that sees only ciphertext](0017-push-relay.md) | accepted (2026-09-06, built the same day) |
| 0018 | [The management plane runs apart from the bots](0018-management-plane.md) | proposed (2026-09-06, planned for 0.3; the quick wins are built) |
| 0019 | [Boundary approvals are connector approvals: for every runtime, chosen per bot](0019-boundary-approvals.md) | proposed (2026-09-06; documentation aligned) |
| 0020 | [Push relay: the sender's key is bound to the device endpoint](0020-relay-sender-binding.md) | proposed (2026-09-06; before outside testers) |
| 0021 | [GitHub Copilot as the fourth runtime, through its CLI's ACP server](0021-copilot-runtime.md) | accepted (2026-09-07, built the same day) |
| 0023 | [Session-aware slash commands in chat](0023-chat-commands.md) | accepted (2026-09-10) |
| 0024 | [Start bot components on demand](0024-components-on-demand.md) | accepted (2026-09-10) |
| 0025 | [Sleep idle runtime processes](0025-runtime-sleep.md) | accepted (2026-09-10) |
| 0026 | [Durable bot event history](0026-bot-events.md) | accepted (2026-09-10) |
| 0027 | [Admit runtime starts against Space RAM](0027-memory-admission.md) | accepted (2026-09-10) |
| 0028 | [Personal settings and Space administration](0028-space-administration.md) | accepted (2026-09-10) |
