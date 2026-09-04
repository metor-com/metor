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
