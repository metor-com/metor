# 0021 – GitHub Copilot as the fourth runtime, through its CLI's ACP server

**Date:** 2026-09-07 · **Status:** accepted (built the same day on the branch `copilot-runtime`; verified in a spike with a Copilot Free account, see `knowledge/harness/copilot-facts.md`)

## Context

metor runs bots on the official coding-agent harnesses with the user's own login (ADR-0004,
ADR-0006, ADR-0011): Claude Code through the Agent SDK, Codex through its app-server, Gemini CLI
over the Agent Client Protocol (ADR-0016). ADR-0011 planned GitHub Copilot as a subscription path
behind OpenCode. Since then GitHub ships its own harness: the **Copilot CLI** (generally available
since February 2026) with an ACP server mode (`copilot --acp`, public preview since January 2026)
and a Copilot SDK that embeds the same engine. One Copilot subscription – any plan, Free included –
carries models from every vendor (Claude, GPT, Gemini, Grok, Kimi, Microsoft's MAI-Code), billed
by AI credits since June 2026. Using the CLI from another program is what GitHub documents and
sells (the SDK, the `Copilot Requests` permission for tokens); its terms name no restriction on
programmatic use. That is path 1 of `subscription-auth-rules.md`: the harness as a process with its
own login, no token extraction.

## Decision

1. **Fourth runtime `copilot`** through the ADR-0011 seam: a registry entry, an adapter
   `metor-host-copilot.mjs`, the role file `AGENTS.md` (the same sister file as Codex; the CLI
   reads it from the bot's directory), the runtime's home `/home/box/.copilot` as the volume
   `metor-copilot`. The CLI is pinned in the image like the other runtimes (`@github/copilot`,
   weekly check) and its auto-update is switched off image-wide (`COPILOT_AUTO_UPDATE=false`),
   because outside CI it would replace itself.
2. **One `copilot --acp` process per bot**, the Gemini adapter's loop: `session/load` resumes the
   bot's session after a restart, `session/new` starts one, `session/prompt` runs a turn,
   `session/update` notifications feed the chat (text chunks, tool calls with their output),
   `session/cancel` is the interrupt. `--allow-all`: the box is the boundary (ADR-0004); permission
   requests, should any arrive, are allowed and logged. `--no-remote-export`: a bot's chat never
   appears on github.com. `--disable-builtin-mcps`: GitHub access is a connector the user chooses
   (ADR-0014), not something every bot carries with the user's token.
3. **MCP servers per bot through a file on the command line** (`--additional-mcp-config
   @<bot>/.copilot/mcp-config.json`, written at every start: the browser via the bot's CDP port
   under the name `playwright`, because Copilot's API reserves the namespace `browser`; routines;
   connectors from Settings) – the CLI ignores ACP's `mcpServers` parameter. The chat
   mechanics (`CHAT_HOWTO`) go into the runtime's global `~/.copilot/copilot-instructions.md`,
   written by the adapter at start, like Gemini's global `GEMINI.md`.
4. **Sign-in with GitHub's device code, under a pseudo-terminal.** The setup assistant's mode
   `device` runs `copilot login --device-code` (link + one-time code, as for Codex). The box has
   no keychain, so the CLI asks afterwards whether to keep the token in a plaintext file – only
   under a terminal; without one it drops the login silently. The setup runner therefore wraps a
   command marked `pty` in `script` (util-linux) and answers the question from the registry
   (`answer`). The token stays inside the box (`~/.copilot/config.json`, the volume).
5. **Models:** "Auto (Copilot decides)" is the default – the CLI picks per task and the badge shows
   which model answered, read from the CLI's own session events, because nothing over ACP names
   it. The list of ids comes from `copilot help config` (cached per CLI version); a pinned id goes
   to the process as `--model`. With the Free account of the spike a pin did not stick (Auto ran);
   whether a paid plan honours it is open, the badge tells the truth either way.

## Consequences

- One more subscription path, and the widest model choice of all runtimes; Copilot Free makes a
  Copilot bot the cheapest way to try metor next to Gemini's key.
- Access is a policy, not only a plan: an organisation can switch off the CLI, third-party MCP
  servers and allow-all for its members – then a Copilot bot fails with "Access denied by policy
  settings" (the chat shows the text, the wizard's hint says where to look). Copilot Business and
  Enterprise users need their admin.
- A failed turn is not a JSON-RPC error: the CLI streams "Error: …" as the answer. The chat's
  sign-in repair recognises the authorization and policy texts.
- Copilot bots cannot message other bots yet (the bridge is Claude-only, see the roadmap) – the
  role file says so, as for Codex and Gemini. Approval cards for "ask first" connectors are not
  wired for Copilot either (ADR-0019 plans them through `session/request_permission`, whose shape
  is verified).
- New volume `metor-copilot:/home/box/.copilot` (backup note in INSTALL.md). Rollback rule as in
  ADR-0011: stop Copilot bots before an image downgrade – older code refuses unknown runtimes.
- ADR-0011's OpenCode plan loses its purpose for Copilot (addendum there).
