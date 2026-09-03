// metor-host-codex – Codex adapter for the neutral host core (ADR-0011, spikes S18–S21 in
// knowledge/harness/codex-facts.md). Spawns `codex app-server` as a child (JSON-RPC 2.0,
// newline-delimited over stdio) and translates its threads/turns/items onto the file IPC:
// thread/resume keeps the context across restarts (like SDK resume with Claude), MCP servers
// (routines + browser via the bot's CDP port) come per process via `-c` overrides,
// CHAT_HOWTO via developerInstructions. Sandbox danger-full-access + approvalPolicy never:
// the box is the boundary (ADR-0004) – Codex has no approval cards in stage 1.
import { spawn } from "node:child_process";
import { CHAT_HOWTO } from "./metor-host-core.mjs";
import { ports } from "./metor-harness.mjs";

const METOR_LIB = "/usr/local/lib/metor";

export async function run(core) {
  const { name, dir, bot } = core;
  const cdp = bot.display ? ports(bot.display).cdp : null;

  const args = ["app-server",
    "-c", 'mcp_servers.routines.command="node"',
    "-c", `mcp_servers.routines.args=["${METOR_LIB}/metor-routines-mcp.mjs","${name}"]`,
    ...(cdp ? [
      "-c", 'mcp_servers.browser.command="playwright-mcp"',
      "-c", `mcp_servers.browser.args=["--cdp-endpoint","http://127.0.0.1:${cdp}"]`,
    ] : []),
  ];
  const child = spawn("codex", args, { cwd: dir, stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, METOR_BOT: name } });
  child.on("error", (e) => core.fail(e));
  child.on("exit", (code, signal) => {
    // Child gone = let the host be restarted (supervisor); thread/resume brings the context back
    if (!shuttingDown) core.fail(new Error(`codex app-server exited (code ${code ?? "-"}, signal ${signal ?? "-"})`));
  });
  child.stderr.on("data", (d) => { const s = String(d).trim(); if (s && !/bubblewrap|sandbox prerequisites/i.test(s)) core.log("codex:", s.slice(0, 300)); });
  let shuttingDown = false;
  core.onShutdown(() => { shuttingDown = true; try { child.kill("SIGTERM"); } catch {} });

  // ---------- JSON-RPC over stdio ----------
  let buf = "", nextId = 1;
  const pending = new Map();
  const send = (method, params) => new Promise((resolve) => {
    const id = nextId++; pending.set(id, resolve);
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
  const notify = (method, params) => child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
  const respond = (id, result) => child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n");

  let turnDone = null;           // resolve of the running turn (turn/completed)
  const toolEntries = new Map(); // item.id → chat entry ID (for result patches)

  function onItemCompleted(item) {
    if (!item?.type) return;
    if (item.type === "agentMessage") { core.emitText(item.text ?? ""); return; }   // commentary AND final_answer
    if (item.type === "mcpToolCall") {
      const detail = `${item.server}/${item.tool} ${JSON.stringify(item.arguments ?? {})}`.slice(0, 200);
      const id = core.emitTool(`${item.server}: ${item.tool}`, detail);
      const result = item.error ? `Error: ${JSON.stringify(item.error).slice(0, 400)}`
        : (item.result?.content ?? []).map((c) => c?.text ?? `[${c?.type}]`).join(" ");
      if (result) core.patchTool(id, result);
      return;
    }
    if (item.type === "commandExecution") {
      const id = core.emitTool("Shell", String(item.command ?? "").slice(0, 200));
      const out = item.aggregatedOutput ?? item.output ?? "";
      core.patchTool(id, `${out}`.slice(0, 1100) + (item.exitCode != null ? `\n(exit ${item.exitCode})` : ""));
      return;
    }
    if (item.type === "fileChange") { core.emitTool("File change", JSON.stringify(item.changes ?? item.path ?? "").slice(0, 200)); return; }
    if (item.type === "webSearch") { core.emitTool("WebSearch", String(item.query ?? "").slice(0, 200)); return; }
    // reasoning, userMessage, plan …: invisible
  }

  child.stdout.on("data", (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      if (!line.trim()) continue;
      let m; try { m = JSON.parse(line); } catch { continue; }
      if (m.id !== undefined && (m.result !== undefined || m.error !== undefined)) {
        const r = pending.get(m.id); pending.delete(m.id); r?.(m); continue;
      }
      if (m.id !== undefined && m.method) {
        // Server request (approvals and the like): should not occur with approvalPolicy "never" –
        // allow defensively (everything is allowed inside the box, ADR-0004) and log it visibly
        core.log("codex server request:", m.method, "→ approved");
        respond(m.id, { decision: "approved" });
        continue;
      }
      const p = m.params ?? {};
      if (m.method === "item/agentMessage/delta") core.partialAppend(String(p.delta ?? p.text ?? ""));
      else if (m.method === "item/completed") onItemCompleted(p.item);
      else if (m.method === "turn/completed") { core.partialClear(); core.saveState({ status: "idle" }); turnDone?.(); }
      else if (m.method === "error") core.log("codex error:", JSON.stringify(p).slice(0, 300));
    }
  });

  // ---------- Build the thread (resume, otherwise new) ----------
  const threadOpts = {
    cwd: dir, sandbox: "danger-full-access", approvalPolicy: "never",
    ...(bot.model ? { model: bot.model } : {}),
    developerInstructions: CHAT_HOWTO,
  };
  await send("initialize", { clientInfo: { name: "metor", title: "metor", version: "1.0" } });
  notify("initialized", {});
  let threadId = core.state.sessionId ?? null;
  if (threadId) {
    const r = await send("thread/resume", { threadId, ...threadOpts });
    if (r.error) { core.log(`thread/resume failed (${r.error.message ?? r.error.code}) – starting a new thread`); threadId = null; }
    else threadId = r.result?.thread?.id ?? threadId;
  }
  if (!threadId) {
    const r = await send("thread/start", threadOpts);
    if (r.error) return core.fail(new Error(`thread/start: ${r.error.message ?? JSON.stringify(r.error)}`));
    threadId = r.result?.thread?.id;
  }
  core.saveState({ sessionId: threadId, status: "idle" });

  let currentTurnId = null;
  core.setInterruptHandler(() => { if (currentTurnId) send("turn/interrupt", { threadId, turnId: currentTurnId }); });

  core.ready();
  // ---------- Turn loop: strictly sequential (one turn after the other) ----------
  for await (const t of core.turns()) {
    const done = new Promise((r) => (turnDone = r));
    const res = await send("turn/start", { threadId, input: [{ type: "text", text: t.text }] });
    if (res.error) {
      core.emitText(`⚠️ Codex error: ${res.error.message ?? JSON.stringify(res.error)}`);
      core.saveState({ status: "idle" });
      continue;
    }
    currentTurnId = res.result?.turn?.id ?? null;
    await done;
    currentTurnId = null;
  }
}
