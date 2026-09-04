// metor-chat-stream – gateway side of the stream harness (ADR-0009).
// Send = user entry in chat.jsonl + line in inbox.jsonl (read by the metor-agent-host).
// Live events = file tail on the chat.jsonl of all stream bots (the host writes them).
// readHistory is the shared history reader for BOTH harness modes (passthrough:
// extra fields like kind/tool/permission survive the reload; status/patch are folded in).
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { isIpcHarness } from "./metor-harness.mjs";

const now = () => new Date().toISOString();

// Write a user turn into history + inbox of a stream bot. Used by the gateway (chat)
// and by the supervisor (routine fires, then with origin:"routine" for the UI marking).
// Attachments (uploads from the UI) live as files under <bot>/uploads/ – the history keeps
// the metadata for rendering, the bot gets the absolute paths in the turn text (the harness
// reads images itself with the Read tool; this way it also works for Codex & co.).
export function injectTurn(botsDir, bot, text, { origin, attachments } = {}) {
  const id = randomUUID();
  const metorDir = join(botsDir, bot, ".metor");
  mkdirSync(metorDir, { recursive: true });
  const atts = sanitizeAttachments(attachments);
  appendFileSync(join(metorDir, "chat.jsonl"), JSON.stringify({ v: 1, id, ts: now(), role: "user", ...(origin ? { origin } : {}), ...(atts ? { attachments: atts } : {}), text, status: "sending" }) + "\n");
  const turnText = [String(text ?? "").trim(),
    ...(atts ?? []).map((a) => `[Attachment${a.image ? " (image)" : ""}: ${join(botsDir, bot, a.path)}]`)].filter(Boolean).join("\n\n");
  appendFileSync(join(metorDir, "inbox.jsonl"), JSON.stringify({ kind: "user", id, ts: now(), text: turnText }) + "\n");
  // Stamp real user messages (not routine fires): anchor for the routines auto-pause
  if (!origin) { try { writeFileSync(join(metorDir, "last-user.json"), JSON.stringify({ ts: now() }) + "\n"); } catch {} }
  return { id };
}
// Only files below uploads/ (no path escape), metadata reduced to the essentials
function sanitizeAttachments(list) {
  if (!Array.isArray(list)) return null;
  const atts = list.filter((a) => typeof a?.path === "string" && a.path.startsWith("uploads/") && !a.path.includes(".."))
    .slice(0, 10)
    .map((a) => ({ path: a.path, name: String(a.name ?? a.path.split("/").pop()).slice(0, 120),
      size: Number(a.size) || 0, image: !!a.image }));
  return atts.length ? atts : null;
}

export function readHistory(botsDir, bot, { limit = 200 } = {}) {
  let raw; try { raw = readFileSync(join(botsDir, bot, ".metor", "chat.jsonl"), "utf8"); } catch { return []; }
  const entries = [], byId = new Map();
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    let e; try { e = JSON.parse(line); } catch { continue; }
    if (e.type === "status") { const t = byId.get(e.ref); if (t) { t.status = e.status; if (e.error) t.error = e.error; } continue; }
    if (e.type === "patch") {
      const t = byId.get(e.ref);
      if (t && e.permission) t.permission = { ...t.permission, ...e.permission };
      if (t && e.tool) t.tool = { ...t.tool, ...e.tool };
      continue;
    }
    const entry = { ...e };
    entries.push(entry); if (e.id) byId.set(e.id, entry);
  }
  return entries.slice(-limit);
}

export function createStreamChat({ botsDir } = {}) {
  botsDir ??= process.env.METOR_BOTS_DIR ?? "/workspace/bots";
  const listeners = new Set();
  const nonces = new Map();
  const harnessOf = (bot) => { try { return JSON.parse(readFileSync(join(botsDir, bot, "bot.json"), "utf8")).harness ?? "claude-stream"; } catch { return null; } };

  function send(bot, text, { sendId, attachments } = {}) {
    if (!existsSync(join(botsDir, bot, "bot.json"))) return { error: `Bot ${bot} does not exist` };
    const hasAtts = Array.isArray(attachments) && attachments.length > 0;
    if ((typeof text !== "string" || !text.trim()) && !hasAtts) return { error: "empty message" };
    if (sendId && nonces.has(sendId)) return { id: nonces.get(sendId), accepted: true, duplicate: true };
    const { id } = injectTurn(botsDir, bot, typeof text === "string" ? text : "", { attachments });
    if (sendId) { nonces.set(sendId, id); if (nonces.size > 64) nonces.delete(nonces.keys().next().value); }
    return { id, accepted: true };
  }

  function interrupt(bot) {
    if (!existsSync(join(botsDir, bot, "bot.json"))) return { error: `Bot ${bot} does not exist` };
    appendFileSync(join(botsDir, bot, ".metor", "inbox.jsonl"), JSON.stringify({ kind: "interrupt", ts: now() }) + "\n");
    return { accepted: true };
  }

  function answerPermission(bot, ref, decision) {
    if (!existsSync(join(botsDir, bot, "bot.json"))) return { error: `Bot ${bot} does not exist` };
    if (typeof ref !== "string" || !["allow", "deny"].includes(decision)) return { error: "ref/decision missing" };
    appendFileSync(join(botsDir, bot, ".metor", "inbox.jsonl"), JSON.stringify({ kind: "permission-answer", ref, decision, ts: now() }) + "\n");
    return { accepted: true };
  }

  // State of the host process (for the status display and the quota in the dock)
  function state(bot) {
    try { return JSON.parse(readFileSync(join(botsDir, bot, ".metor", "harness.json"), "utf8")); } catch { return {}; }
  }
  function status(bot) {
    const s = state(bot);
    const alive = s.pid && (() => { try { process.kill(s.pid, 0); return true; } catch { return false; } })();
    if (!alive) return "stopped";
    return s.status === "busy" ? "busy" : s.status === "error" ? "waiting" : "idle";
  }

  // ---------- Messenger view of a chat (bot list): last message, its time, unread count ----------
  // "Read" = the moment the user last looked at that chat (read.json, written by the gateway on
  // request of the interface). Only the tail of the history is scanned – 64 KB is hundreds of
  // entries – and grown until it reaches an entry older than the read mark; cached per file state.
  const summaries = new Map();
  const isMessage = (e) => e && !e.type && (e.role === "user" || (e.role === "assistant" && (e.kind === "text" || e.kind === "permission")));
  const preview = (e) => {
    const text = String(e.text ?? "").replace(/```[\s\S]*?```/g, " ").replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[*_`#>|]+/g, "").replace(/\s+/g, " ").trim();
    if (text) return text.slice(0, 160);
    const n = e.attachments?.length ?? 0;
    return n ? `${n} attachment${n === 1 ? "" : "s"}` : "";
  };
  function readAt(bot) { try { return Date.parse(JSON.parse(readFileSync(join(botsDir, bot, ".metor", "read.json"), "utf8")).ts) || 0; } catch { return 0; } }
  function markRead(bot) {
    if (!existsSync(join(botsDir, bot, "bot.json"))) return { error: `Bot ${bot} does not exist` };
    const dir = join(botsDir, bot, ".metor"); mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "read.json"), JSON.stringify({ ts: now() }) + "\n");
    return { ok: true };
  }
  function summary(bot) {
    const empty = { lastMessageAt: null, lastMessage: null, unread: 0 };
    const file = join(botsDir, bot, ".metor", "chat.jsonl");
    let st; try { st = statSync(file); } catch { return empty; }
    const read = readAt(bot);
    const key = `${st.size}:${st.mtimeMs}:${read}`;
    const cached = summaries.get(bot); if (cached?.key === key) return cached.value;
    let chunk = 65536, value = empty;
    for (;;) {
      const start = Math.max(0, st.size - chunk);
      const fd = openSync(file, "r"); const buf = Buffer.alloc(st.size - start); readSync(fd, buf, 0, buf.length, start); closeSync(fd);
      const lines = buf.toString("utf8").split("\n"); if (start > 0) lines.shift();   // the cut-off first line
      const entries = lines.map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter((e) => e?.ts);
      const complete = start === 0 || (entries.length && Date.parse(entries[0].ts) <= read) || chunk >= 4 * 1024 * 1024;
      if (complete) {
        const msgs = entries.filter(isMessage);
        const last = msgs[msgs.length - 1] ?? null;
        value = { lastMessageAt: last ? Date.parse(last.ts) : null,
          lastMessage: last ? { who: last.role === "user" ? "you" : last.kind === "permission" ? "approval" : "bot", text: preview(last) } : null,
          unread: msgs.filter((e) => e.role === "assistant" && Date.parse(e.ts) > read).length };
        break;
      }
      chunk *= 4;
    }
    summaries.set(bot, { key, value });
    return value;
  }

  // Tail: chat.jsonl of all stream bots; new lines → listeners (offsets start at the end of the file,
  // the UI fetches the history via readHistory – no cursor needed, a reconnect refetches anyway).
  // Plus partial.json (the host's token streaming): change → transient {type:"partial"} entry.
  const offsets = new Map();
  const partials = new Map();
  function tailTick() {
    let names = [];
    try { names = readdirSync(botsDir); } catch { return; }
    for (const bot of names) {
      if (!isIpcHarness(harnessOf(bot))) continue;   // all host runtimes (claude-stream, codex, …)
      let pRaw = null; try { pRaw = readFileSync(join(botsDir, bot, ".metor", "partial.json"), "utf8"); } catch {}
      if (pRaw !== partials.get(bot)) {
        partials.set(bot, pRaw);
        let p = null; try { p = JSON.parse(pRaw); } catch {}
        for (const cb of listeners) { try { cb({ bot, entry: { type: "partial", text: p?.text ?? null } }); } catch {} }
      }
      const file = join(botsDir, bot, ".metor", "chat.jsonl");
      let size; try { size = statSync(file).size; } catch { continue; }
      if (!offsets.has(file)) { offsets.set(file, { offset: size, rest: "" }); continue; }
      const st = offsets.get(file);
      if (size < st.offset) { st.offset = 0; st.rest = ""; }
      if (size === st.offset) continue;
      const fd = openSync(file, "r");
      const buf = Buffer.alloc(size - st.offset);
      readSync(fd, buf, 0, buf.length, st.offset); closeSync(fd);
      st.offset = size;
      const lines = (st.rest + buf.toString("utf8")).split("\n"); st.rest = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        let e; try { e = JSON.parse(line); } catch { continue; }
        for (const cb of listeners) { try { cb({ bot, entry: e }); } catch {} }
      }
    }
  }
  const timer = setInterval(tailTick, 400);

  return {
    send, answerPermission, interrupt, status, state, summary, markRead, readHistory: (bot, opts) => readHistory(botsDir, bot, opts),
    subscribe(cb) { listeners.add(cb); return () => listeners.delete(cb); },
    close() { clearInterval(timer); },
  };
}
