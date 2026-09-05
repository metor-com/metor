# 0016 – Gemini CLI as the third runtime, signed in over its agent protocol

**Date:** 2026-09-05 · **Status:** accepted (implemented and verified with a working key: turns, tool calls, resume, model list)

## Context

metor runs bots on the official coding-agent harnesses with the user's own login (ADR-0004,
ADR-0006, ADR-0011): Claude Code through the Agent SDK, Codex through its app-server. Google's
harness is the open-source **Gemini CLI**. Its free tier needs no subscription – a Gemini API
key from Google AI Studio (about 1,000 requests a day) – which makes it the cheapest way to try
metor. The Google-account login of the CLI was the first choice and was built (its link-and-code
flow is the same as Claude's), but on the day of the build Google closed it for the CLI: the
`authenticate` request answers "This client is no longer supported for Gemini Code Assist for
individuals … migrate to the Antigravity suite of products". The facts are in
`knowledge/harness/gemini-facts.md`.

## Decision

1. **Third runtime `gemini`** through the ADR-0011 seam: a registry entry, an adapter
   `metor-host-gemini.mjs`, the role file `GEMINI.md` (sister of CLAUDE.md and AGENTS.md), MCP
   servers in the bot's `.gemini/settings.json` (browser via the bot's CDP port, routines,
   connectors from Settings), the runtime's home `/home/box/.gemini` as the volume `metor-gemini`.
2. **One `gemini --acp` process per bot** – the Agent Client Protocol, JSON-RPC over stdio like
   Codex's app-server: `session/load` resumes the bot's session after a restart, `session/new`
   starts one, `session/prompt` runs a turn, `session/update` notifications feed the chat
   (text chunks, tool calls and their results), `session/cancel` is the interrupt. Approval mode
   `yolo` and a trusted workspace: the box is the boundary (ADR-0004); permission requests, should
   any arrive, are allowed and logged. The chat mechanics (`CHAT_HOWTO`) reach every Gemini bot
   through the runtime's global `~/.gemini/GEMINI.md`, written by the adapter at start.
3. **Sign-in with an API key, kept inside the box.** The setup assistant (new mode `key`) asks
   for a Gemini API key, checks it with one small request through the CLI and stores it in the
   runtime's home (`.env`, mode 600) – it never leaves the box, and the interface never shows it
   again. The adapter hands it to the ACP process and calls `authenticate {methodId:
   "gemini-api-key"}` before the session. The Google-account flow (`authenticate
   {methodId: "oauth-personal"}` over ACP: the CLI prints Google's link and reads the code Google
   shows – the shape of Claude's flow) is documented in the facts file and can return as a
   second mode should Google reopen it; the setup runner's `env`/`stdin`/`done` hooks for it stay.
4. **Models:** with the key, `session/new` over ACP lists them (Auto plus the concrete models);
   the choice is "Auto (Gemini decides)" – no `-m`, the CLI picks per task and the answer names
   the model that ran, which the label shows – or a listed or pinned id.

## Consequences

- Trying metor costs nothing: a free key from Google AI Studio, no subscription.
- This is the one runtime where the user brings a key instead of a login – not a subscription
  token (ADR-0004/ADR-0006 stay intact), and it is stored like a connector secret: inside the
  box only.
- The interactive TUI's own login was deliberately not automated (keystrokes under a
  pseudo-terminal); ACP gives the same flow structured.
- Gemini bots cannot message other bots yet (the bridge is Claude-only, see the roadmap) –
  the role file says so, as for Codex.
- Verified with a working key the same day: a shell task in about ten seconds, tool cards from
  `tool_call`, the session resumed after a host restart, the model list and the model used.
