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
| Design | [design/crew-messaging-groups.md](design/crew-messaging-groups.md) | **Draft**: bot↔bot bridge for all runtimes + group chats (orchestrator with hard caps) |
| Decisions | [decisions/](decisions/) | ADRs for metor |
| Archive material | — | Third-party source material and the notes derived from it are kept outside this repository (ADR-0006) |

## Conventions

- One topic per file, Markdown, English; terms according to [GLOSSARY.md](GLOSSARY.md).
- Every claim with a source (link) or code reference (`repo:path:line`).
- Changes to facts: add a date instead of silently overwriting.
