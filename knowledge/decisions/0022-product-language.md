# ADR-0022: Agent, Bot and Space

Status: accepted, 2026-09-09.

## Decision

Agent is the general technology/category. A Bot is a persistent, named agent instance
in metor. A Space is the environment where multiple bots live and run.

“metor is a home for your agents. In metor, agents become persistent bots.”

Use Agent in website/SEO, technical docs, architecture, comparisons and developer contexts.
Use Bot for product instances in normal UI, including “New Bot”. Use Space for the shared
environment, including “Your Spaces” and “Connect a Space…”. Do not use Agent and Bot
synonymously within the UI. Computer remains the bot’s screen/terminal panel or hardware.

This supersedes the environment wording in earlier glossary and design documents. Existing
API paths, CLI commands, storage and internal identifiers stay compatible. The binding
reference is [the glossary](../GLOSSARY.md).
