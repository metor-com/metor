# 0014 – Connectors: MCP servers configured once, for every bot

**Date:** 2026-09-04 · **Status:** accepted (implemented)

## Context

Every bot has the browser, the terminal, its files and the routines tool. Everything else that
the Model Context Protocol offers – search APIs, documentation lookups, GitHub, a shared memory –
had to be wired into each bot's `mcp.json` by hand inside the box, and only for Claude Code.
The user wants to add such servers in the interface, either from a list of well-known ones or by
hand, the way Claude Code's `claude mcp add` works, and to have them apply to all bots.

## Decision

1. **One store for the computer**: `/workspace/.metor/connectors.json` holds every connector
   (`key`, `name`, `transport` stdio | http | sse, `command`+`args`+`env` or `url`+`headers`,
   `enabled`, `source` custom | directory). The `key` is the MCP server name the runtimes see
   (tool prefix `mcp__<key>__…`), derived from the name like a bot id; `browser` and `routines`
   are reserved for the built-in servers.
2. **Secrets stay inside the computer.** Tokens in `env` or `headers` are stored in the clear
   next to the runtimes' own credentials (ADR-0004: inside the box everything is readable); the
   API masks them on the way out, and a masked value sent back means "keep what is stored".
3. **Both runtimes, at start.** Claude Code gets the connectors merged into the bot's `mcp.json`
   (built-ins win on a key clash); Codex gets them as `-c mcp_servers.<key>.*` overrides on the
   app-server command line (remote servers through `url`, Codex speaks streamable HTTP). A
   connector therefore reaches a bot when the bot (re)starts; the interface offers one button
   that bounces every running bot through the serial command queue.
4. **A curated directory** ships in the image (`templates/connectors.json`): a short list of
   well-known servers with their command or URL and the keys they need, described in our own
   words. Picking one pre-fills the form; the user adds the token. Servers that need an OAuth
   browser flow are left out – a bot's session runs headless and cannot complete one.
5. **Pre-approved by default.** Adding a connector is the user loosening the boundary
   (ADR-0004), so its tools run without an approval card – Claude Code gets `mcp__<key>__*`
   as allowed tools, the same rule the built-in browser and routines have. A connector can be
   marked "ask before each use"; then every call shows the approval card (Claude Code bots; Codex
   bots run without approval prompts inside the box).
6. **Every bot for now.** `forBot()` in `metor-connectors.mjs` is the seam for a per-bot
   selection later (a list of disabled keys in `bot.json`).

## Consequences

- A change is only live after a restart; the interface says so and offers it.
- The Claude host logs which MCP servers connected at session start (`MCP: browser connected,
  …`), so a broken connector is visible in `metor bot logs`.
- `npx -y …` connectors download their package at the first start of each bot process
  (cached afterwards); the box needs outbound network for that.
- Open: per-bot selection, a `metor connector` CLI, OAuth for remote servers, and a health
  check of a connector before it is saved.
