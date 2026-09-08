// metor-host-copilot – GitHub Copilot CLI adapter for the neutral host core (ADR-0011, ADR-0021;
// facts in knowledge/harness/copilot-facts.md). Spawns `copilot --acp` as a child – the Agent
// Client Protocol, JSON-RPC 2.0 newline-delimited over stdio, the same loop as the Gemini adapter –
// and translates sessions/prompts/updates onto the file IPC: session/load keeps the context across
// restarts, MCP servers (routines + browser via the bot's CDP port, connectors) come from the bot's
// .copilot/mcp-config.json through --additional-mcp-config (the ACP parameter is ignored by the
// CLI), the chat mechanics (CHAT_HOWTO) from the runtime's global copilot-instructions.md.
// --allow-all: the box is the boundary (ADR-0004) – permission requests, should any arrive, are
// allowed and logged. --no-remote-export: a bot's chat never appears on github.com.
import { spawn } from "node:child_process";
import { closeSync, mkdirSync, openSync, readSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CHAT_HOWTO, acpStep } from "./metor-host-core.mjs";
import { COPILOT_HOME, recordSeenModel } from "./metor-harness.mjs";

export async function run(core) {
  const { name, dir, bot } = core;

  // The chat mechanics reach every Copilot bot through the runtime's global instructions file
  // (verified 2026-09-07: ~/.copilot/copilot-instructions.md is read for every session, an AGENTS.md
  // in COPILOT_CUSTOM_INSTRUCTIONS_DIRS is not) – central, so protocol changes reach existing bots;
  // the bot's own AGENTS.md stays its role and memory
  try { mkdirSync(COPILOT_HOME, { recursive: true }); writeFileSync(join(COPILOT_HOME, "copilot-instructions.md"), `# metor\n\n${CHAT_HOWTO}\n`); } catch (e) { core.log("global copilot-instructions.md:", e.message); }

  // The built-in GitHub MCP server stays off: GitHub access is a connector the user chooses (ADR-0014),
  // not something every bot carries with the user's token
  const mcpFile = join(dir, ".copilot", "mcp-config.json");   // written by the registry's writeMcpConfig at every start
  const args = ["--acp", "--allow-all", "--no-auto-update", "--no-remote-export", "--disable-builtin-mcps",
    "--additional-mcp-config", `@${mcpFile}`,
    ...(bot.model && bot.model !== "auto" ? ["--model", bot.model] : [])];
  const child = spawn("copilot", args, { cwd: dir, stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, METOR_BOT: name, COPILOT_AUTO_UPDATE: "false" } });
  let shuttingDown = false;
  child.on("error", (e) => core.fail(e));
  child.on("exit", (code, signal) => { if (!shuttingDown) core.fail(new Error(`copilot --acp exited (code ${code ?? "-"}, signal ${signal ?? "-"})`)); });
  child.stderr.on("data", (d) => { const s = String(d).trim(); if (s) core.log("copilot:", s.slice(0, 300)); });
  core.onShutdown(() => { shuttingDown = true; try { child.kill("SIGTERM"); } catch {} });

  // ---------- JSON-RPC over stdio ----------
  let buf = "", nextId = 1;
  const pending = new Map();
  const send = (method, params) => new Promise((resolve) => { const id = nextId++; pending.set(id, resolve); child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n"); });
  const notify = (method, params) => child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
  const respond = (id, result) => child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n");

  // ---------- Session updates → chat entries ----------
  let turnText = "";                 // the answer of the running prompt, assembled from chunks
  let loading = false;               // session/load replays the history – not shown again
  const toolEntries = new Map();     // toolCallId → chat entry id
  const toolOutput = new Map();      // toolCallId → the last output seen (the CLI streams it cumulatively)
  const text = (c) => (Array.isArray(c) ? c : [c]).map((x) => x?.type === "text" ? x.text : x?.type === "content" ? text(x.content) : x?.text ?? "").join("");
  const tidy = (s) => String(s ?? "").replace(/\n?<shellId: \d+ completed with exit code 0>\s*$/, "");   // the shell tool's own footer on success
  const outputOf = (u) => u.content?.length ? text(u.content) : u.rawOutput != null ? (typeof u.rawOutput === "string" ? u.rawOutput : u.rawOutput.content ?? JSON.stringify(u.rawOutput)) : "";
  function onUpdate(u) {
    if (!u || loading) return;
    switch (u.sessionUpdate) {
      case "agent_message_chunk": { const t = text(u.content); if (t) { turnText += t; core.partialAppend(t); } break; }
      case "agent_thought_chunk": break;                                       // reasoning stays invisible, as with the other runtimes
      case "tool_call": {
        // Shell calls carry their command; MCP tools only their input object (an empty text must not hide it)
        const detail = String(u.rawInput?.command || u.rawInput?.description || text(u.content ?? []) || JSON.stringify(u.rawInput ?? {})).replace(/\s+/g, " ").slice(0, 200);
        toolEntries.set(u.toolCallId, core.emitTool(u.title ?? u.kind ?? "Tool", detail, acpStep(u)));
        break;
      }
      case "tool_call_update": {
        // The output grows with every update while a command runs – the card gets the final one
        // (the status says so); what a tool leaves without a status is patched when the turn ends
        const id = toolEntries.get(u.toolCallId); if (!id) break;
        const out = outputOf(u);
        if (out) toolOutput.set(u.toolCallId, out);
        if (u.status === "completed" || u.status === "failed") {
          toolOutput.delete(u.toolCallId);
          if (out || u.status === "failed") core.patchTool(id, tidy(out).slice(0, 1100) + (u.status === "failed" ? "\n(failed)" : ""));
        }
        break;
      }
      default: break;                                                          // usage_update, session_info_update, config_option_update, available_commands_update, user_message_chunk …
    }
  }
  function finishTools() {
    for (const [callId, out] of toolOutput) { const id = toolEntries.get(callId); if (id) core.patchTool(id, tidy(out).slice(0, 1100)); }
    toolOutput.clear();
  }

  child.stdout.on("data", (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      if (!line.trim()) continue;
      let m; try { m = JSON.parse(line); } catch { core.log("copilot (not JSON):", line.slice(0, 200)); continue; }
      if (m.id !== undefined && (m.result !== undefined || m.error !== undefined)) { const r = pending.get(m.id); pending.delete(m.id); r?.(m); continue; }
      if (m.id !== undefined && m.method) {
        // Requests from the agent: permissions are allowed (everything is allowed inside the box, ADR-0004);
        // file and terminal access are handled by the agent itself (we declared no client capabilities)
        if (m.method === "session/request_permission") {
          const opts = m.params?.options ?? [];
          const pick = opts.find((o) => o.kind === "allow_once") ?? opts.find((o) => /allow/.test(o.kind ?? "")) ?? opts[0];
          core.log("copilot permission request:", m.params?.toolCall?.title ?? "?", "→", pick?.kind ?? "no option");
          respond(m.id, { outcome: pick ? { outcome: "selected", optionId: pick.optionId } : { outcome: "cancelled" } });
        } else { core.log("copilot request:", m.method, "→ not supported"); child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: m.id, error: { code: -32601, message: "not supported by metor" } }) + "\n"); }
        continue;
      }
      if (m.method === "session/update") onUpdate(m.params?.update);
      else if (m.method) core.log("copilot notification:", m.method);
    }
  });

  // ---------- Initialize, then load the session (resume) or start a new one ----------
  const init = await send("initialize", { protocolVersion: 1, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } }, clientInfo: { name: "metor", version: "1.0" } });
  if (init.error) return core.fail(new Error(`initialize: ${init.error.message ?? JSON.stringify(init.error)}`));
  const canLoad = !!init.result?.agentCapabilities?.loadSession;
  // The CLI's login is not done over ACP (initialize only names `copilot login`) – a missing one shows up here
  const notLoggedIn = (e) => /authentication required/i.test(e?.message ?? "");
  const loginError = () => new Error("Not logged in: GitHub Copilot needs a sign-in – New bot → GitHub Copilot → Sign in, then start the bot again");
  let sessionId = core.state.sessionId ?? null;
  if (sessionId && canLoad) {
    loading = true;
    const r = await send("session/load", { sessionId, cwd: dir, mcpServers: [] });
    loading = false;
    if (r.error && notLoggedIn(r.error)) return core.fail(loginError());
    if (r.error) { core.log(`session/load failed (${r.error.message ?? r.error.code}) – starting a new session`); sessionId = null; }
  } else if (sessionId) { core.log("this Copilot CLI cannot load sessions – starting a new one"); sessionId = null; }
  if (!sessionId) {
    const r = await send("session/new", { cwd: dir, mcpServers: [] });   // MCP servers come from the file on the command line
    if (r.error && notLoggedIn(r.error)) return core.fail(loginError());
    if (r.error) return core.fail(new Error(`session/new: ${r.error.message ?? JSON.stringify(r.error)}`));
    sessionId = r.result?.sessionId;
  }
  core.saveState({ sessionId, status: "idle" });

  let promptRunning = false;
  core.setInterruptHandler(() => { if (promptRunning) notify("session/cancel", { sessionId }); });

  core.ready();
  // ---------- Turn loop: strictly sequential ----------
  for await (const t of core.turns()) {
    turnText = ""; promptRunning = true;
    const res = await send("session/prompt", { sessionId, prompt: [{ type: "text", text: t.text }] });
    promptRunning = false;
    finishTools();
    if (res.error) core.emitText(`⚠️ Copilot error: ${res.error.message ?? JSON.stringify(res.error)}`);
    else if (turnText.trim()) core.emitText(turnText);
    else core.partialClear();
    // Which model answered: nothing over ACP says, the CLI's own session events do – the label behind "Auto"
    const used = seenModel(sessionId);
    if (used) try { recordSeenModel("copilot", bot.model ?? "auto", [used], used); } catch {}
    // A cancelled prompt ends as end_turn (verified); anything else is worth a log line
    if (res.result?.stopReason && !["end_turn", "cancelled"].includes(res.result.stopReason)) core.log("stop reason:", res.result.stopReason);
    core.saveState({ status: "idle" });
  }
}

// The model that ran, from the tail of the CLI's session events (its private format – best effort):
// `session.auto_mode_resolved` names Auto's choice, `session.model_change` a pinned model
function seenModel(sessionId) {
  try {
    const f = join(COPILOT_HOME, "session-state", sessionId, "events.jsonl");
    const size = statSync(f).size, len = Math.min(size, 65536);
    const fd = openSync(f, "r"); const b = Buffer.alloc(len); readSync(fd, b, 0, len, size - len); closeSync(fd);
    const s = b.toString("utf8");
    const chosen = [...s.matchAll(/"chosenModel":"([^"]+)"/g)].map((m) => m[1]).pop();
    if (chosen) return chosen;
    return [...s.matchAll(/"newModel":"([^"]+)"/g)].map((m) => m[1]).filter((m) => m !== "auto").pop() ?? null;
  } catch { return null; }
}
