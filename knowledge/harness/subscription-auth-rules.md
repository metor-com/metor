# Subscriptions in third-party tools: what is allowed

## Two paths

1. **Harness as a process** – `claude -p` / `@anthropic-ai/claude-agent-sdk`, `codex exec` / app-server.
   Inference runs inside the official CLI with its login. **Clean.** This is how OpenMausBot and
   `openclaw-code-agent` do it.
2. **Token extraction** – `claude setup-token` (`sk-ant-oat01-…`), `~/.codex/auth.json` directly against the API.
   - Anthropic: **not allowed** per policy ("does not permit third-party developers to … route requests
     through Free, Pro, or Max plan credentials"), blocked server-side since Jan 2026.
   - OpenAI: grey area; Hermes and some community routers do it anyway.

## Timeline Anthropic × third-party agents (researched 2026-08-31)

- **Jan 2026:** subscription tokens blocked outside Claude Code (see above).
- **April 2026:** enforcement – the subscription no longer covers OpenClaw/third parties
  ("outsized strain"); extra-usage bundles announced (TechCrunch/TechRadar, 2026-04-04).
- **May 2026:** re-admission announced: a dedicated monthly Agent SDK allowance
  (Pro $20, Max 5x $100, Max 20x $200, expiring), start 15 June (VentureBeat).
- **15 June 2026:** Anthropic **pauses** the allowance model. Official status quo
  (support.claude.com, article 15036540): **Agent SDK, `claude -p` and third-party apps
  run on the normal subscription limits** – i.e. own use is sanctioned,
  but explicitly as an interim state ("we are working on the plan, changes will be announced").
- **Consequence for metor:** path 1 (harness as process/Agent SDK) is exactly the mechanism
  Anthropic currently lets run on subscription limits – our architecture (ADR-0009)
  is thereby on the sanctioned side. The ADR-0006 grey area "BYO subscription" is defused for
  **own use**; for **offering** claude.ai login to third parties, "unless previously approved"
  still applies (tier C unchanged: API key). Caveat: the state is "paused",
  limit/price changes possible.

## Rule for metor

Path 1 only. Plug our own tools into the harness via **MCP** (stdio or HTTP MCP servers). API keys
only for providers without a subscription harness (OpenRouter etc.).

## Sources

- https://docs.openclaw.ai/concepts/oauth
- https://openclawlaunch.com/guides/openclaw-claude-subscription
- https://github.com/NousResearch/hermes-agent/issues/25267
