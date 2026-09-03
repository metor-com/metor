# Codex CLI – verified facts (spikes S18–S21, 2026-09-01, codex-cli 0.152.0)

Context: slice 7 (ADR-0011) runs Codex as a second runtime. All points verified inside the container
(Debian bookworm, arm64, user `box`) unless noted otherwise.

| Fact | Detail | Evidence |
|---|---|---|
| **Install** | npm `@openai/codex` ships static musl binaries (amd64+arm64); runs without further dependencies in the box image | S18 |
| **Device login works headless** | `codex login --device-auth` prints a link (`https://auth.openai.com/codex/device`) + one-time code (pattern `XXXX-XXXXX`, 15 min); output contains ANSI codes → strip before parsing. Line anchors: "Open this link" / "one-time code" | S18 |
| **Account gate: device-code authorisation** | The flow fails with a red notice until the user enables "device code authorisation" in the **ChatGPT security settings** – then RESTART `codex login --device-auth` (the old code expires). Must be in the setup assistant | S18, experienced first-hand |
| **Login probe** | `codex login status` → "Logged in using ChatGPT", exit 0; not logged in → exit ≠ 0. Suitable as supervisor gate | S18 |
| **Credentials** | `~/.codex/auth.json` (mode 600). `$CODEX_HOME` relocates everything → volume `metor-codex:/home/box/.codex` | S18 |
| **app-server = transport** | `codex app-server` (subcommand "experimental"): JSON-RPC 2.0, newline-delimited over stdio. Handshake: `initialize` {clientInfo{name,title,version}} → response, then notification `initialized`. Schema fully generatable: `codex app-server generate-json-schema --out <dir>` (98 client methods, 81 server notifications) | S19 |
| **Thread lifecycle** | `thread/start` {cwd, model, sandbox:"danger-full-access", approvalPolicy:"never", developerInstructions} → thread.id (= sessionId, rollout JSONL under `~/.codex/sessions/…`). `turn/start` {threadId, input:[{type:"text",text}]} responds IMMEDIATELY (status inProgress) – the end arrives as notification `turn/completed`. `turn/interrupt` {threadId, turnId} exists | S19 |
| **Resume keeps context** | Kill the process → new app-server → `thread/resume` {threadId, cwd, …} → "Which number…?" → correctly "7413". Same semantics as SDK resume with Claude | S19 |
| **Streaming** | `item/agentMessage/delta` delivers text deltas (→ partial.json); `item/completed` with item.type `agentMessage` (field `phase`: `commentary` = interim text, `final_answer`), `mcpToolCall` {server,tool,arguments,result,durationMs}, `commandExecution`, `reasoning` (ignore), `userMessage` (echo) | S19/S20 |
| **MCP per bot: `-c` overrides** | `codex app-server -c 'mcp_servers.<n>.command="node"' -c 'mcp_servers.<n>.args=[…]'` starts stdio MCP servers per PROCESS (= per bot; CDP port/bot name as args). `metor-routines-mcp.mjs` ran unchanged: list_tasks → correct JSON from the right bot. Status via `mcpServer/startupStatus/updated` | S20 |
| **AGENTS.md works** | The file in `cwd` is loaded as instructions (code-word test). Role file for Codex bots = `AGENTS.md` instead of CLAUDE.md | S21 |
| **developerInstructions** | Parameter to thread/start (also resume) for central protocol instructions (CHAT_HOWTO) – no detour via a global AGENTS.md needed | S19 (accepted), effect implicit |
| **Sandbox inside the container** | bubblewrap missing → warning `configWarning` at start (harmless); with sandbox danger-full-access + approvalPolicy never, turns run without approval requests. The box is the boundary (ADR-0004) | S19–S21 |
| **Quota** | `turn/completed` carried no usage at the expected place in the test; there are `thread/tokenUsage/updated` notifications and `account/rateLimits/read` as a request → a Codex quota display is POSSIBLE, deferred in stage 1 | S21 |
| **Models** | gpt-5.6-sol / -terra / -luna; selection via thread/start.model (accepted) or `-c model=…`; a `model/list` request exists | research + S19 |

Pitfalls:
- `docker exec` WITHOUT `-i` swallows heredocs (stdin) – always run spike scripts with `-i`.
- Do NOT interpret the turn/start response as the end of the turn (it arrives immediately).
- Several processes share `~/.codex` – community warning about token-refresh races; observe,
  escalation path CODEX_HOME per bot (ADR-0011).
