# metor – Knowledge Base

Collected knowledge for building **metor** (an agent platform built on the official
harnesses – Claude Code, Codex – and the user's own subscriptions).

As of: 2026-08-30. Sources are linked in every document; statements derived from reverse engineering
are marked as such.

## Contents

**[Glossary](GLOSSARY.md)** – binding terms (UI / code / prompt).

| Area | Document | Contents |
|---|---|---|
| Harness | [harness/subscription-auth-rules.md](harness/subscription-auth-rules.md) | What is allowed with Claude/ChatGPT subscriptions |
| Harness | [harness/claude-code-facts.md](harness/claude-code-facts.md) | Verified Claude Code facts: `--bg`, Remote Control, resume semantics, trust, login inside the container |
| Harness | [harness/codex-facts.md](harness/codex-facts.md) | Verified Codex facts (spikes S18–S21): device login, app-server protocol, resume, MCP per bot, AGENTS.md |
| Harness | [harness/gemini-facts.md](harness/gemini-facts.md) | Verified Gemini CLI facts: API-key sign-in, ACP session shapes, resume, MCP via settings.json |
| Harness | [harness/copilot-facts.md](harness/copilot-facts.md) | Verified Copilot CLI facts: device login under a pty, ACP shapes, cancel, resume, MCP via --additional-mcp-config, policies |
| Design | [design/crew-messaging-groups.md](design/crew-messaging-groups.md) | **Draft**: bot↔bot bridge for all runtimes + group chats (orchestrator with hard caps) |
| Design | [design/several-computers.md](design/several-computers.md) | Several bots' computers in the desktop and phone app – the overview behind the back arrow, the warm switch (built 2026-09-07/08) |
| Design | [design/file-transfer.md](design/file-transfer.md) | **Draft**: whole directories in and out of a bot's directory through the gateway – archive and tar routes, transfer strip, resume later |
| Design | [design/working-view.md](design/working-view.md) | What the chat shows while a bot works – steps folded into one line, a live line in the user's language, thinking live only (built 2026-09-08) |
| Decisions | [decisions/](decisions/) | ADRs for metor |
| Archive material | — | Third-party source material and the notes derived from it are kept outside this repository (ADR-0006) |

## Conventions

- One topic per file, Markdown, English; terms according to [GLOSSARY.md](GLOSSARY.md).
- Every claim with a source (link) or code reference (`repo:path:line`).
- Changes to facts: add a date instead of silently overwriting.
