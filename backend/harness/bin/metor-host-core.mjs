// metor-host-core – the harness-neutral core of every bot host (ADR-0011).
// Owns the complete file IPC (inbox.jsonl in; chat.jsonl, harness.json, partial.json
// out), the turn queue, approvals, file cards and the lifecycle. The adapters
// (metor-host-claude.mjs, metor-host-codex.mjs) only translate between this core and
// their respective harness – UI and gateway see the same files for all runtimes.
import { appendFileSync, closeSync, mkdirSync, openSync, readFileSync, readSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { randomUUID } from "node:crypto";

const BOTS_DIR = process.env.METOR_BOTS_DIR ?? "/workspace/bots";

// Chat mechanics centrally in the host instead of in the per-bot role file (CLAUDE.md/AGENTS.md belongs
// to the bot as role/memory and is not overwritten on updates – this way protocol changes
// also reach existing bots). Claude gets the text as a systemPrompt append,
// Codex as developerInstructions.
export const CHAT_HOWTO = `Chatting with the user (metor interface):
- Showing files: write "[File: path/to/file]" (relative to your directory) on its own line in your reply – the chat renders it as a card with preview/download and removes the marker from the text. Use this for results, screenshots and exports instead of quoting long files. File paths you mention in the text (e.g. in backticks) are additionally offered as cards automatically.
- The user's attachments reach you as "[Attachment: /path]" lines (the files are under uploads/); look at images with your file-reading tool.`;

export function createCore(name) {
  const dir = join(BOTS_DIR, name);
  const metorDir = join(dir, ".metor");
  mkdirSync(metorDir, { recursive: true });
  const bot = JSON.parse(readFileSync(join(dir, "bot.json"), "utf8"));
  const chatFile = join(metorDir, "chat.jsonl");
  const inboxFile = join(metorDir, "inbox.jsonl");
  const cursorFile = join(metorDir, "inbox-cursor.json");
  const stateFile = join(metorDir, "harness.json");
  const partialFile = join(metorDir, "partial.json");
  const now = () => new Date().toISOString();
  const log = (...a) => console.log(now(), ...a);
  const chat = (entry) => appendFileSync(chatFile, JSON.stringify(entry) + "\n");

  let state = { sessionId: null };
  try { state = { ...state, ...JSON.parse(readFileSync(stateFile, "utf8")) }; } catch {}
  // Double-start protection: if a host is already running for this bot, exit immediately (second
  // line of defense next to the start.lock in metor.mjs). Mind PID reuse: the command line must
  // name metor-agent-host AND this bot, and the PID must be a process, not a thread – a stale PID
  // from the previous container can be a thread ID of THIS process (kill(tid, 0) succeeds and
  // /proc/<tid>/cmdline shows the thread group's command line; hit on 2026-09-02).
  if (state.pid && state.pid !== process.pid) {
    try {
      process.kill(state.pid, 0);
      const argv = readFileSync(`/proc/${state.pid}/cmdline`, "utf8").split("\0");
      const isProcess = new RegExp(`^Tgid:\\s+${state.pid}$`, "m").test(readFileSync(`/proc/${state.pid}/status`, "utf8"));
      if (isProcess && argv.some((a) => a.includes("metor-agent-host")) && argv.includes(name)) {
        console.error(`Host for ${name} is already running (pid ${state.pid}) – exiting.`);
        process.exit(3);
      }
    } catch {}
  }
  function saveState(patch) { state = { ...state, ...patch, pid: process.pid, updatedAt: now() }; writeFileSync(stateFile, JSON.stringify(state) + "\n"); }
  saveState({ status: "starting" });

  // ---------- Inbound: turn queue, fed from inbox.jsonl ----------
  let wake = null;
  const queue = [];
  function enqueueTurn(t) { queue.push(t); if (wake) { const w = wake; wake = null; w(); } }
  // Adapters consume turns through this; the yield marks the turn as delivered and the bot as busy
  async function* turns() {
    for (;;) {
      while (!queue.length) await new Promise((r) => (wake = r));
      const t = queue.shift();
      if (t.id) chat({ v: 1, type: "status", ref: t.id, status: "delivered", ts: now() });
      saveState({ status: "busy" });
      yield t;
    }
  }

  // Inbox tail (byte offset + cursor file)
  let inboxOffset = 0, inboxRest = "";
  try { inboxOffset = JSON.parse(readFileSync(cursorFile, "utf8")).offset ?? 0; } catch {}
  const pendingPerms = new Map();
  let onInterrupt = null;
  function inboxTick() {
    let size; try { size = statSync(inboxFile).size; } catch { return; }
    if (size < inboxOffset) { inboxOffset = 0; inboxRest = ""; }
    if (size === inboxOffset) return;
    const fd = openSync(inboxFile, "r");
    const buf = Buffer.alloc(size - inboxOffset);
    readSync(fd, buf, 0, buf.length, inboxOffset); closeSync(fd);
    inboxOffset = size;
    const lines = (inboxRest + buf.toString("utf8")).split("\n"); inboxRest = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      let m; try { m = JSON.parse(line); } catch { continue; }
      if (m.kind === "user" && typeof m.text === "string") enqueueTurn({ id: m.id, text: m.text });
      else if (m.kind === "permission-answer" && pendingPerms.has(m.ref)) pendingPerms.get(m.ref)(m.decision === "allow" ? "allow" : "deny");
      else if (m.kind === "interrupt") { log("Interrupt from the UI"); Promise.resolve(onInterrupt?.()).catch((e) => log("Interrupt failed:", e.message)); }
    }
    try { writeFileSync(cursorFile, JSON.stringify({ offset: inboxOffset - Buffer.byteLength(inboxRest) }) + "\n"); } catch {}
  }
  const inboxTimer = setInterval(inboxTick, 300);

  // ---------- Approvals: card into the history, park without deadline, answer from the inbox ----------
  async function askPermission(toolName, { title, reason, input, signal } = {}) {
    const id = randomUUID();
    chat({ v: 2, id, ts: now(), role: "assistant", kind: "permission", text: `Approval needed: ${title ?? toolName}`,
      permission: { tool: toolName, title: title ?? toolName, reason: reason ?? null, input: JSON.stringify(input ?? {}).slice(0, 300), status: "pending" } });
    log("Approval requested:", toolName, title ?? "");
    if (process.env.METOR_NTFY_URL) {
      fetch(process.env.METOR_NTFY_URL, { method: "POST", body: `${name}: approval needed – ${title ?? toolName}`,
        headers: { Title: "metor - waiting for approval", Priority: "high", Tags: "bell" } }).catch(() => {});
    }
    const decision = await new Promise((resolve) => {
      pendingPerms.set(id, resolve);
      signal?.addEventListener?.("abort", () => resolve("deny"), { once: true });
    });
    pendingPerms.delete(id);
    chat({ v: 2, type: "patch", ref: id, ts: now(), permission: { status: decision === "allow" ? "allowed" : "denied" } });
    log("Approval decided:", toolName, decision);
    return decision;
  }

  // ---------- Token streaming: running text as a transient partial.json ----------
  let partialText = "", partialDirty = false, lastPartialWrite = 0;
  function writePartial(force = false) {
    if (!force && Date.now() - lastPartialWrite < 250) { partialDirty = true; return; }
    lastPartialWrite = Date.now(); partialDirty = false;
    try { writeFileSync(partialFile, JSON.stringify({ ts: now(), text: partialText || null }) + "\n"); } catch {}
  }
  const partialTimer = setInterval(() => { if (partialDirty) writePartial(true); }, 300);
  writePartial(true); // clear the old state from the last run
  const partialAppend = (delta) => { partialText += delta; writePartial(); };
  const partialClear = () => { partialText = ""; writePartial(true); };

  // ---------- Bot→user attachments: [File:] markers + automatically detected mentioned paths ----------
  const IMG_EXT = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg"]);
  function fileMeta(p) {
    try {
      const rel = (p.trim().startsWith("/") ? relative(dir, p.trim()) : p.trim()).replace(/^\.\//, "");
      if (!rel || rel.startsWith("..") || rel.split("/").some((s) => s.startsWith(".") || !s)) return null;
      const st = statSync(join(dir, rel));
      if (!st.isFile()) return null;
      return { path: rel, name: rel.split("/").pop(), size: st.size,
        image: IMG_EXT.has(rel.split(".").pop()?.toLowerCase() ?? "") };
    } catch { return null; }
  }
  function extractFiles(raw) {
    const attachments = [], seen = new Set();
    const push = (meta) => {
      if (!meta || seen.has(meta.path) || attachments.length >= 10) return !!meta && seen.has(meta.path);
      seen.add(meta.path); attachments.push(meta); return true;
    };
    // "[File: …]" is the protocol; "[Datei: …]" stays accepted for bots created before the English switch
    const text = raw.replace(/\[(?:File|Datei):\s*([^\]\n]+)\]/g, (marker, p) => (push(fileMeta(p)) ? "" : marker))
      .replace(/\n{3,}/g, "\n\n").trim();
    for (const m of text.matchAll(/`([^`\n]+)`/g)) {
      const c = m[1];
      if (c.includes("/") || /\.[A-Za-z0-9]{1,8}$/.test(c)) push(fileMeta(c) ?? fileMeta(c.replace(/[.,:;)]+$/, "")));
    }
    for (const m of text.matchAll(/\/workspace\/bots\/[\w.-]+\/[\wäöüÄÖÜß./-]+/g)) {
      push(fileMeta(m[0]) ?? fileMeta(m[0].replace(/[.,:;)]+$/, "")));
    }
    for (const m of text.matchAll(/(?:^|[\s("'„])((?:[\wäöüÄÖÜß.-]+\/)*[\wäöüÄÖÜß-]+\.[A-Za-z0-9]{1,8})/gm)) {
      push(fileMeta(m[1]));
    }
    return { text, attachments: attachments.length ? attachments : null };
  }

  // Finished assistant text → history entry with file cards, clear the streaming bubble
  function emitText(rawText, extra = {}) {
    if (!rawText?.trim()) return;
    const { text, attachments } = extractFiles(rawText);
    chat({ v: 2, id: randomUUID(), ts: now(), role: "assistant", kind: "text", text, ...(attachments ? { attachments } : {}), ...extra });
    partialClear();
  }
  // Tool activity → entry (returns the id for later result patches)
  function emitTool(toolName, detail) {
    const id = randomUUID();
    chat({ v: 2, id, ts: now(), role: "assistant", kind: "tool", text: `Tool: ${toolName}`, tool: { name: toolName, detail } });
    return id;
  }
  function patchTool(ref, result) { chat({ v: 2, type: "patch", ref, ts: now(), tool: { result: String(result ?? "").slice(0, 1200) } }); }

  // ---------- Lifecycle ----------
  const cleanups = [];
  function shutdown() {
    clearInterval(inboxTimer);
    clearInterval(partialTimer);
    partialClear();
    saveState({ status: "stopped" });
    for (const fn of cleanups) { try { fn(); } catch {} }
    setTimeout(() => process.exit(0), 500);
  }
  process.on("SIGTERM", shutdown); process.on("SIGINT", shutdown);

  return {
    name, dir, metorDir, bot, now, log, chat,
    get state() { return state; },
    saveState,
    turns,
    setInterruptHandler(fn) { onInterrupt = fn; },
    askPermission,
    partialAppend, partialClear,
    extractFiles, emitText, emitTool, patchTool,
    onShutdown(fn) { cleanups.push(fn); },
    ready() { saveState({ status: "idle", error: null }); log(`Host for ${name} started (harness ${bot.harness ?? "claude-stream"}, resume: ${state.sessionId ?? "-"})`); },
    fail(e) { log("Harness error:", e?.message ?? e); saveState({ status: "error", error: String(e?.message ?? e) }); process.exit(1); },
  };
}
