// metor-host-gemini – Gemini CLI adapter for the neutral host core (ADR-0011, ADR-0016; facts in
// knowledge/harness/gemini-facts.md). Spawns `gemini --acp` as a child – the Agent Client
// Protocol, JSON-RPC 2.0 newline-delimited over stdio, the same shape as Codex's app-server –
// and translates sessions/prompts/updates onto the file IPC: session/load keeps the context
// across restarts, MCP servers (routines + browser via the bot's CDP port, connectors) come
// from the bot's .gemini/settings.json, the chat mechanics (CHAT_HOWTO) from the runtime's
// global GEMINI.md. Approval mode yolo: the box is the boundary (ADR-0004) – permission
// requests, should any arrive, are allowed and logged.
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CHAT_HOWTO } from "./metor-host-core.mjs";
import { geminiKey, recordSeenModel } from "./metor-harness.mjs";

const GEMINI_HOME = process.env.GEMINI_CLI_HOME ?? join(process.env.HOME ?? "/home/box", ".gemini");

export async function run(core) {
  const { name, dir, bot } = core;

  // The chat mechanics reach every Gemini bot through the runtime's global context file – central,
  // so protocol changes reach existing bots; the bot's own GEMINI.md stays its role and memory
  try { mkdirSync(GEMINI_HOME, { recursive: true }); writeFileSync(join(GEMINI_HOME, "GEMINI.md"), `# metor\n\n${CHAT_HOWTO}\n`); } catch (e) { core.log("global GEMINI.md:", e.message); }

  const args = ["--acp", "--approval-mode", "yolo", "--skip-trust", ...(bot.model && bot.model !== "default" ? ["-m", bot.model] : [])];
  const key = geminiKey();   // from the runtime's .env (the assistant stores it there); ACP wants it in the environment
  if (!key) return core.fail(new Error("Gemini needs an API key – sign in under New bot → Gemini CLI → Sign in, then start the bot again"));
  const child = spawn("gemini", args, { cwd: dir, stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, METOR_BOT: name, NO_BROWSER: "true", GEMINI_CLI_TRUST_WORKSPACE: "true", ...(key ? { GEMINI_API_KEY: key } : {}) } });
  let shuttingDown = false;
  child.on("error", (e) => core.fail(e));
  child.on("exit", (code, signal) => { if (!shuttingDown) core.fail(new Error(`gemini --acp exited (code ${code ?? "-"}, signal ${signal ?? "-"})`)); });
  child.stderr.on("data", (d) => { const s = String(d).trim(); if (s) core.log("gemini:", s.slice(0, 300)); });
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
  const text = (c) => (Array.isArray(c) ? c : [c]).map((x) => x?.type === "text" ? x.text : x?.type === "content" ? text(x.content) : x?.text ?? "").join("");
  function onUpdate(u) {
    if (!u || loading) return;
    switch (u.sessionUpdate) {
      case "agent_message_chunk": { const t = text(u.content); if (t) { turnText += t; core.partialAppend(t); } break; }
      case "agent_thought_chunk": break;                                       // reasoning stays invisible, as with the other runtimes
      case "tool_call": {
        if (u.kind === "think") break;                                         // the CLI's internal topic/plan bookkeeping – not a tool for the user
        const detail = (text(u.content ?? []) || JSON.stringify(u.rawInput ?? {})).replace(/\s+/g, " ").slice(0, 200);
        toolEntries.set(u.toolCallId, core.emitTool(u.title ?? u.kind ?? "Tool", detail));
        break;
      }
      case "tool_call_update": {
        const id = toolEntries.get(u.toolCallId); if (!id) break;
        const out = u.content?.length ? text(u.content) : u.rawOutput != null ? (typeof u.rawOutput === "string" ? u.rawOutput : JSON.stringify(u.rawOutput)) : "";
        if (out || u.status === "failed") core.patchTool(id, `${out}`.slice(0, 1100) + (u.status === "failed" ? "\n(failed)" : ""));
        break;
      }
      default: break;                                                          // plan, user_message_chunk, available_commands_update …
    }
  }

  child.stdout.on("data", (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      if (!line.trim()) continue;
      let m; try { m = JSON.parse(line); } catch { core.log("gemini (not JSON):", line.slice(0, 200)); continue; }
      if (m.id !== undefined && (m.result !== undefined || m.error !== undefined)) { const r = pending.get(m.id); pending.delete(m.id); r?.(m); continue; }
      if (m.id !== undefined && m.method) {
        // Requests from the agent: permissions are allowed (everything is allowed inside the box, ADR-0004);
        // file and terminal access are handled by the agent itself (we declared no client capabilities)
        if (m.method === "session/request_permission") {
          const opts = m.params?.options ?? [];
          const pick = opts.find((o) => o.kind === "allow_once") ?? opts.find((o) => /allow/.test(o.kind ?? "")) ?? opts[0];
          core.log("gemini permission request:", m.params?.toolCall?.title ?? "?", "→", pick?.kind ?? "no option");
          respond(m.id, { outcome: pick ? { outcome: "selected", optionId: pick.optionId } : { outcome: "cancelled" } });
        } else { core.log("gemini request:", m.method, "→ not supported"); child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: m.id, error: { code: -32601, message: "not supported by metor" } }) + "\n"); }
        continue;
      }
      if (m.method === "session/update") onUpdate(m.params?.update);
      else if (m.method) core.log("gemini notification:", m.method);
    }
  });

  // ---------- Initialize, then load the session (resume) or start a new one ----------
  const init = await send("initialize", { protocolVersion: 1, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } } });
  if (init.error) return core.fail(new Error(`initialize: ${init.error.message ?? JSON.stringify(init.error)}`));
  const canLoad = !!init.result?.agentCapabilities?.loadSession;
  if (key) { const a = await send("authenticate", { methodId: "gemini-api-key" }); if (a.error) return core.fail(new Error(`authenticate: ${a.error.message ?? JSON.stringify(a.error)}`)); }
  let sessionId = core.state.sessionId ?? null;
  if (sessionId && canLoad) {
    loading = true;
    const r = await send("session/load", { sessionId, cwd: dir, mcpServers: [] });
    loading = false;
    if (r.error) { core.log(`session/load failed (${r.error.message ?? r.error.code}) – starting a new session`); sessionId = null; }
  } else if (sessionId) { core.log("this Gemini CLI cannot load sessions – starting a new one"); sessionId = null; }
  if (!sessionId) {
    const r = await send("session/new", { cwd: dir, mcpServers: [] });   // MCP servers come from .gemini/settings.json in the bot's directory
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
    if (res.error) core.emitText(`⚠️ Gemini error: ${res.error.message ?? JSON.stringify(res.error)}`);
    else if (turnText.trim()) core.emitText(turnText);
    else core.partialClear();
    // The result names the model that answered (quota.model_usage) – the label behind "Auto"
    const used = (res.result?._meta?.quota?.model_usage ?? []).map((m) => m.model).filter(Boolean);
    if (used.length) try { recordSeenModel("gemini", bot.model ?? "default", used, used[0]); } catch {}
    if (res.result?.stopReason && !["end_turn", "cancelled"].includes(res.result.stopReason)) core.log("stop reason:", res.result.stopReason);
    core.saveState({ status: "idle" });
  }
}
