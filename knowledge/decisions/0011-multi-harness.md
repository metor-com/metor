# ADR-0011: Multi-harness – registry, one host entry point, Codex via app-server

Status: accepted (2026-09-01) · Context: slice 7 · Related: ADR-0004, ADR-0006, ADR-0009, ADR-0010

## Decision

1. **UI term "Runtime", code term stays `harness`** (GLOSSARY). Every bot carries `harness` + `model`
   in bot.json; both are chosen on creation (default: claude-stream + the registry's default model).
2. **Every model vendor runs through its own official harness** with that harness's subscription login –
   never token extraction, never third-party OAuth (Anthropic explicitly forbids subscription OAuth in
   third-party harnesses; OpenCode had to remove its Anthropic auth in 03/2026). Claude → Claude Code,
   ChatGPT → Codex; OpenCode later as the door to GitHub Copilot (official partnership, device flow).
3. **Harness registry** (`metor-harness.mjs`) as the single source of knowledge: id, label, kind
   (`ipc-host`; seam for later: `http`), adapterModule, models, roleFile/roleTemplate, scaffold,
   writeMcpConfig, needsTrustDir, loginProbe, setup (device | code | terminal; "code" since
   2026-09-03: the CLI prints the link, the user pastes the code from the browser into the UI, used
   for Claude Code). Legacy mode `"claude"`
   (--bg bridge) stayed outside as a fallback until it was removed on 2026-09-02 (ADR-0009 addendum).
4. **One host entry point** (`metor-agent-host.mjs` as dispatcher + `metor-host-core.mjs` neutral core +
   adapters `metor-host-claude.mjs`/`metor-host-codex.mjs`): hostAlive, start.lock, host.pid, PROC_MATCH
   stay unchanged; the file IPC (inbox/chat/harness/partial) remains THE contract between host, gateway
   and UI.
5. **Codex transport: `codex app-server`** (JSON-RPC/stdio; spikes S18–S21 in
   `knowledge/harness/codex-facts.md`): thread/start+resume (context is kept), turn/start,
   turn/interrupt, item notifications → chat.jsonl mapping; MCP per bot via `-c mcp_servers…` process
   overrides; CHAT_HOWTO via `developerInstructions`; sandbox danger-full-access + approvalPolicy never
   (the box is the boundary, ADR-0004) – stage 1 therefore without approval cards for Codex (app-server
   approvals as a later extension).
6. **Login gate per harness** in the supervisor (loginProbe per runtime) instead of globally.
7. **Role files:** Claude bots CLAUDE.md, Codex bots AGENTS.md (templates `CLAUDE.md`/`AGENTS.md`
   in `harness/templates/`, "sister file" note in both).
8. **Bot↔bot for non-Claude runtimes is deliberately left out** (own follow-up slice: neutral bridge via
   MCP `send_to_bot` through injectTurn; sketch in the BACKLOG).

## Consequences

- OpenCode/further runtimes only add registry + adapter (+ possibly kind "http").
- Rollback rule: stop Codex bots before an image downgrade – code older than ADR-0011 would treat
  `harness:"codex"` as a legacy "claude" bot; code since 2026-09-02 refuses unknown runtimes instead.
- The token-refresh race on the shared `~/.codex` is accepted in stage 1 (symptom → host status:error
  with a clear message); escalation path: CODEX_HOME per bot.
- New volume `metor-codex:/home/box/.codex` (backup note in INSTALL.md).
