#!/usr/bin/env node
// metor gateway – one port for UI, API and all bot screens.
//   GET /bots/                      → UI (static frontend build; fallback: mini page)
//   *   /bots/api/…                 → JSON API + one SSE stream (topics: agents, chat:<name>)
//   *   /bots/<name>/…              → the bot's websockify/noVNC (HTTP + WebSocket)
// Runs inside the computer on 0.0.0.0:6010; on the host published on 127.0.0.1 only, with Caddy + login in front.
import http from "node:http";
import net from "node:net";
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { execFile } from "node:child_process";
import { createStreamChat, readHistory } from "./metor-chat-stream.mjs";
import { readRoutines, readRuns } from "./metor-routines.mjs";
import { HARNESSES, harnessOf, defaultModel, validModel } from "./metor-harness.mjs";
import { setupStart, setupStatus, setupCancel, setupSubmit } from "./metor-setup.mjs";
import { BOTS_DIR, RESERVED_NAMES as RESERVED, isValidName as validName, isValidTitle as validTitle, idFor, allBots as bots } from "./metor-store.mjs";
import { AUTH_OFF, sessionOf, claimSession, createClaim, listSessions, revokeSession, setCookieHeader, clearCookieHeader, clientIp, tooManyAttempts, noteFailure, signInPage, qrDataUrl } from "./metor-auth.mjs";
import * as push from "./metor-push.mjs";
import * as connectors from "./metor-connectors.mjs";

const PORT = Number(process.env.METOR_GATEWAY_PORT ?? 6010);
const BASE = (process.env.METOR_WATCH_BASE ?? "").replace(/\/$/, "");
const FRONTEND_DIR = process.env.METOR_FRONTEND_DIR ?? "/usr/local/lib/metor/frontend";

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
// path= forces noVNC onto the gateway path; without it, it connects to ws://…/websockify at the root (no bot there).
function watchPath(b) { return `/bots/${b.name}/vnc.html?autoconnect=1&resize=scale&path=bots/${b.name}/websockify&password=${b.watchToken}`; }

// ---------- Status: from each bot's harness.json (written by its host process) ----------
// Latest chat activity = mtime of the history file (every message and status line touches it), else creation
function lastActivity(b) {
  let t = Date.parse(b.createdAt ?? "") || 0;
  try { t = Math.max(t, statSync(join(BOTS_DIR, b.name, ".metor", "chat.jsonl")).mtimeMs); } catch {}
  return Math.round(t);
}
async function agentList() {
  return bots().map((b) => {
    const h = harnessOf(b);
    return { name: b.name, title: b.title ?? b.name, role: b.role ?? "", createdAt: b.createdAt ?? null, lastActivityAt: lastActivity(b), display: b.display ?? null,
      harness: h, harnessLabel: HARNESSES[h]?.label ?? h,
      model: b.model ?? null,
      modelLabel: HARNESSES[h]?.models.find((m) => m.id === b.model)?.label ?? (b.model ?? "Default model"),
      status: streamChat.status(b.name),
      quota: streamChat.state(b.name).quota ?? null };
  });
}

// Login state per runtime, cached for 30 s (the probe is a subprocess)
const probeCache = new Map();
function harnessSetupState(id) {
  const c = probeCache.get(id);
  if (c && Date.now() - c.ts < 30_000) return c.probe;
  const probe = HARNESSES[id].loginProbe();
  probeCache.set(id, { ts: Date.now(), probe });
  return probe;
}
function harnessInfo() {
  return Object.values(HARNESSES).map((h) => {
    const probe = harnessSetupState(h.id);
    return { id: h.id, label: h.label, models: h.models,
      setup: { ok: probe.ok, detail: probe.detail, mode: h.setup.mode,
        ...(h.setup.mode === "terminal" ? { command: h.setup.command } : {}), ...(h.setup.hint ? { hint: h.setup.hint } : {}) } };
  });
}

// ---------- Command queue: metor bot … strictly serial (parallel creates → freeDisplay race) ----------
let chain = Promise.resolve();
const creating = new Set();   // ids queued for "bot create" but not on disk yet (duplicate check)
function enqueue(args) {
  const id = args[0] === "bot" && args[1] === "create" ? args[args.indexOf("--id") + 1] : null;
  if (id) creating.add(id);
  const p = chain.then(() => new Promise((done) => {
    execFile("metor", args, { encoding: "utf8", timeout: 180_000 }, (err, stdout, stderr) => {
      if (err) console.error(`metor ${args.slice(0, 3).join(" ")}: ${(stderr || stdout || err.message).trim().split("\n").pop()}`);
      done({ ok: !err, out: `${stdout ?? ""}${stderr ?? ""}`.trim() });
    });
  })).then(async (r) => { if (id) creating.delete(id); await pushAgents(true); return r; }, (e) => { if (id) creating.delete(id); throw e; });
  chain = p.then(() => {}, () => {});
  return p;
}

// ---------- SSE hub: one stream per client with a topic filter; commands arrive as JSON POSTs ----------
const sseClients = new Set();
function sseEmit(channel, type, data) {
  const payload = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const c of sseClients) if (c.topics.has(channel)) { try { c.res.write(payload); } catch {} }
}
setInterval(() => { for (const c of sseClients) { try { c.res.write(": keepalive\n\n"); } catch {} } }, 20_000);
let lastAgentsJson = "";
async function pushAgents() {
  const list = await agentList();
  const j = JSON.stringify(list);
  if (j !== lastAgentsJson) { lastAgentsJson = j; sseEmit("agents", "agents", list); }
}
setInterval(() => { if (sseClients.size) pushAgents().catch(() => {}); }, 3000);

// ---------- Chat transport: inbox.jsonl in, chat.jsonl/partial.json out (one seam for every runtime) ----------
const streamChat = createStreamChat({ botsDir: BOTS_DIR });
streamChat.subscribe(({ bot, entry }) => sseEmit(`chat:${bot}`, "chat", { bot, entry }));

// ---------- Push notifications (ADR-0013): approvals, finished turns, unexpected stops ----------
// A device whose interface shows that bot's chat right now (open SSE stream with its topic) is skipped;
// the interface closes its stream while in the background, so a phone in the pocket does get the push.
const viewers = (bot) => new Set([...sseClients].filter((c) => c.sessionId && c.topics.has(`chat:${bot}`)).map((c) => c.sessionId));
const liveSessions = () => (AUTH_OFF ? null : new Set(listSessions().map((s) => s.id)));
function notifyPush(kind, bot, msg) {
  push.notify({ kind, bot, url: `/bots/#/${bot}`, ...msg }, { skip: viewers(bot), sessions: liveSessions() })
    .then((r) => { if (r.sent || r.failed || r.removed) console.log(`push: ${kind} for ${bot} – ${r.sent} sent${r.failed ? `, ${r.failed} failed` : ""}${r.removed ? `, ${r.removed} dropped` : ""}`); })
    .catch((e) => console.error("push:", e.message));
}
const excerpt = (t) => String(t ?? "").replace(/```[\s\S]*?```/g, " ").replace(/[*_`#>|]+/g, "").replace(/\s+/g, " ").trim().slice(0, 180);
const titleOf = (bot) => bots().find((b) => b.name === bot)?.title ?? bot;   // people see the title, not the id
const expectedStops = new Set();   // bots the interface itself stops or removes
const turnText = new Map();        // bot → last assistant text of the running turn (body of the "reply" push)
streamChat.subscribe(({ bot, entry }) => {
  if (entry.kind === "permission" && entry.permission?.status === "pending") {
    const p = entry.permission;
    notifyPush("approval", bot, { title: `${titleOf(bot)}: approval needed`, body: excerpt(p.reason ? `${p.title ?? p.tool} – ${p.reason}` : (p.title ?? p.tool ?? entry.text)) });
  } else if (entry.role === "assistant" && entry.kind === "text" && entry.text?.trim()) turnText.set(bot, entry.text);
});
const lastStatus = new Map();
setInterval(() => {
  const known = new Set();
  for (const b of bots()) {
    known.add(b.name);
    const st = streamChat.status(b.name), prev = lastStatus.get(b.name);
    lastStatus.set(b.name, st);
    if (prev === undefined || prev === st) continue;
    if (prev === "busy" && st === "idle") {
      // the chat tail (400 ms) may still be behind the state file – give the last text a moment to arrive
      setTimeout(() => { const text = turnText.get(b.name); turnText.delete(b.name); if (text) notifyPush("reply", b.name, { title: b.title ?? b.name, body: excerpt(text) }); }, 1000);
    } else if (st === "stopped") {
      turnText.delete(b.name);
      if (expectedStops.delete(b.name)) continue;
      const s = streamChat.state(b.name);
      notifyPush("stopped", b.name, { title: `${b.title ?? b.name}: stopped`, body: s.status === "error" ? `Error: ${excerpt(s.error)}` : "The bot's host process ended unexpectedly." });
    }
  }
  for (const name of [...lastStatus.keys()]) if (!known.has(name)) { lastStatus.delete(name); turnText.delete(name); expectedStops.delete(name); }
}, 2000);

// ---------- JSON API ----------
function readBody(req) {
  return new Promise((done) => {
    let buf = ""; req.on("data", (d) => { buf += d; if (buf.length > 65536) { req.destroy(); done(null); } });
    req.on("end", () => { try { done(JSON.parse(buf)); } catch { done(null); } });
    req.on("error", () => done(null));
  });
}
async function api(req, res, url) {
  const send = (code, obj) => { res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify(obj)); };
  const u = new URL(url, "http://gateway");
  const rest = u.pathname.split("/").filter(Boolean).slice(2); // after /bots/api/

  if (req.method === "GET" && rest[0] === "events") {
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive", "x-accel-buffering": "no" });
    res.write("retry: 2000\n\n");
    const topics = new Set((u.searchParams.get("topics") ?? "agents").split(",").filter(Boolean));
    const client = { res, topics, sessionId: sessionOf(req)?.id ?? null };   // who is looking – push skips active viewers
    sseClients.add(client);
    req.on("close", () => sseClients.delete(client));
    // Every new client gets the current list at once – the broadcast (pushAgents) only fires on changes
    if (client.topics.has("agents")) agentList().then((list) => { try { res.write(`event: agents\ndata: ${JSON.stringify(list)}\n\n`); } catch {} }).catch(() => {});
    return;
  }
  // Devices (ADR-0012): the session behind the cookie, all sessions, pairing, sign-out
  if (rest[0] === "auth") {
    const session = sessionOf(req);
    if (rest[1] === "me" && req.method === "GET") return send(200, { id: session.id, name: session.name, authOff: AUTH_OFF });
    if (rest[1] === "sessions" && rest.length === 2 && req.method === "GET") return send(200, listSessions().map((s) => ({ ...s, current: s.id === session.id })));
    if (rest[1] === "sessions" && rest.length === 3 && req.method === "DELETE") { const ok = revokeSession(rest[2]); if (ok) push.dropSession(rest[2]); return send(ok ? 200 : 404, { ok: true }); }
    if (rest[1] === "logout" && req.method === "POST") { revokeSession(session.id); push.dropSession(session.id); res.writeHead(200, { "content-type": "application/json", "set-cookie": clearCookieHeader() }); return res.end("{}"); }
    if (rest[1] === "pair" && req.method === "POST") {
      const c = createClaim("pair", { createdBy: session.id });
      let qr = null; try { qr = await qrDataUrl(c.url); } catch (e) { console.error("qr:", e.message); }
      return send(200, { url: c.url, code: c.code, expiresAt: c.expiresAt, qr });
    }
  }
  // Push notifications (ADR-0013): the gateway's public key, this device's subscription, a test message
  if (rest[0] === "push") {
    const session = sessionOf(req);
    if (rest[1] === "key" && req.method === "GET") { const key = await push.publicKey(); return send(200, { enabled: !!key, publicKey: key, subscribed: key ? push.countForSession(session.id) : 0 }); }
    if (rest[1] === "subscribe" && req.method === "POST") { const body = await readBody(req); const r = push.subscribe(session.id, body?.subscription, req.headers["user-agent"]); return send(r.error ? 400 : 200, r); }
    if (rest[1] === "unsubscribe" && req.method === "POST") { const body = await readBody(req); return send(200, push.unsubscribe(String(body?.endpoint ?? ""))); }
    if (rest[1] === "test" && req.method === "POST") return send(200, await push.notify({ kind: "test", title: "metor", body: "Push notifications reach this device.", url: "/bots/" }, { only: new Set([session.id]) }));
  }
  // Connectors (ADR-0014): MCP servers for every bot, plus the curated directory; a change reaches
  // a bot when it (re)starts – "restart" bounces every running bot through the serial queue
  if (rest[0] === "connectors") {
    if (rest.length === 1 && req.method === "GET") return send(200, { connectors: connectors.list() });
    if (rest[1] === "directory" && req.method === "GET") return send(200, { directory: connectors.directory() });
    if (rest.length === 1 && req.method === "POST") { const r = connectors.add(await readBody(req)); return send(r.error ? 400 : 200, r); }
    if (rest[1] === "restart" && req.method === "POST") {
      const names = bots().filter((b) => streamChat.status(b.name) !== "stopped").map((b) => b.name);
      for (const name of names) { expectedStops.add(name); enqueue(["bot", "stop", name]); enqueue(["bot", "start", name]); }
      return send(202, { accepted: true, bots: names });
    }
    if (rest.length === 2 && req.method === "PUT") { const r = connectors.update(rest[1], await readBody(req)); return send(r.error ? (r.error.includes("not found") ? 404 : 400) : 200, r); }
    if (rest.length === 2 && req.method === "DELETE") { const r = connectors.remove(rest[1]); return send(r.error ? 404 : 200, r); }
  }
  if (rest[0] === "harnesses" && rest.length === 1 && req.method === "GET") return send(200, harnessInfo());
  // Setup assistant: start/observe/cancel the runtime's device login
  if (rest[0] === "harnesses" && HARNESSES[rest[1]] && rest[2] === "setup" && rest.length === 4) {
    const id = rest[1];
    if (rest[3] === "start" && req.method === "POST") return send(200, setupStart(id));
    if (rest[3] === "status" && req.method === "GET") {
      const r = setupStatus(id);
      if (r.state === "done") probeCache.delete(id);   // freshly logged in → discard the probe cache
      return send(200, r);
    }
    if (rest[3] === "cancel" && req.method === "POST") return send(200, setupCancel(id));
    // Mode "code": the code the provider showed the user, handed to the waiting CLI (never logged)
    if (rest[3] === "code" && req.method === "POST") { const body = await readBody(req); return send(200, setupSubmit(id, body?.code)); }
  }
  if (rest[0] === "agents" && rest.length === 1) {
    if (req.method === "GET") return send(200, await agentList());
    if (req.method === "POST") {
      const body = await readBody(req);
      // The title is free text; the id comes from it (slugify) unless the client sends one explicitly
      const title = String(body?.title ?? body?.name ?? "").trim().replace(/\s+/g, " ");
      const role = String(body?.role ?? "").trim() || "General assistant for the user.";
      if (!validTitle(title)) return send(400, { error: "name missing or longer than 60 characters" });
      let name;
      try { name = body?.name != null && String(body.name) !== "" ? String(body.name) : idFor(title); } catch (e) { return send(400, { error: e.message }); }
      if (!validName(name)) return send(400, { error: "invalid id (a-z, 0-9, hyphen, at most 40 characters; api/assets are reserved)" });
      if (existsSync(join(BOTS_DIR, name, "bot.json")) || creating.has(name)) return send(409, { error: `A bot with the id "${name}" already exists – pick another name or change the id` });
      const harness = body?.harness ?? "claude-stream";
      if (!HARNESSES[harness]) return send(400, { error: `unknown runtime: ${harness}` });
      const model = body?.model ?? defaultModel(harness);
      if (model && !validModel(harness, model)) return send(400, { error: `unknown model "${model}" for ${HARNESSES[harness].label}` });
      if (!harnessSetupState(harness).ok) return send(409, { error: `${HARNESSES[harness].label} is not set up yet`, needsSetup: true, harness });
      enqueue(["bot", "create", title, "--id", name, "--role", role, "--harness", harness, ...(model ? ["--model", model] : [])]);
      return send(202, { accepted: true, name, title });
    }
  }
  if (rest[0] === "agents" && validName(rest[1])) {
    const name = rest[1], action = rest[2];
    const b = bots().find((x) => x.name === name);
    if (!b) return send(404, { error: `Bot ${name} does not exist` });
    if (req.method === "POST" && ["start", "stop", "rm"].includes(action) && rest.length === 3) {
      if (action !== "start" && streamChat.status(name) !== "stopped") expectedStops.add(name);   // no "stopped" push for a stop the user asked for
      enqueue(["bot", action, name]);
      return send(202, { accepted: true });
    }
    if (req.method === "GET" && action === "routines" && rest.length === 3) {
      return send(200, { routines: readRoutines(BOTS_DIR, name), runs: readRuns(BOTS_DIR, name) });
    }
    if (req.method === "GET" && action === "watch-url" && rest.length === 3) {
      if (!b.display || !b.watchToken) return send(404, { error: "no desktop" });
      return send(200, { path: watchPath(b) });
    }
    if (action === "chat" && rest[3] === "send" && req.method === "POST") {
      const body = await readBody(req);
      const r = streamChat.send(name, body?.text, { sendId: body?.sendId, attachments: body?.attachments });
      return send(r.error ? 400 : 202, r);
    }
    // Attachments: raw body → <bot>/uploads/<stamp>-<name> (no multipart needed)
    if (action === "chat" && rest[3] === "upload" && req.method === "POST") return uploadFile(req, res, name, u, send);
    // Serve a file (chat attachments in both directions + file browser): everything below the
    // bot directory EXCEPT dot paths (.metor, .browser, .desktop, .claude – that's where histories,
    // browser profile and state live). Access like the whole API: behind the Caddy login.
    if (action === "chat" && rest[3] === "file" && req.method === "GET") {
      const rel = String(u.searchParams.get("path") ?? "");
      const file = safeBotPath(name, rel);
      if (!file || !existsSync(file) || !statSync(file).isFile()) return send(404, { error: "file not found" });
      const st = statSync(file);
      res.writeHead(200, { "content-type": MIME[file.split(".").pop()?.toLowerCase()] ?? "application/octet-stream",
        "content-length": st.size,
        // uploads/ carry a timestamp in the name (immutable), bot files can change
        "cache-control": rel.startsWith("uploads/") ? "public, max-age=31536000, immutable" : "no-store" });
      return createReadStream(file).pipe(res);
    }
    // File browser: directory listing (dot entries hidden)
    if (req.method === "GET" && action === "files" && rest.length === 3) {
      const rel = String(u.searchParams.get("path") ?? "").replace(/^\/+|\/+$/g, "");
      const dirPath = rel ? safeBotPath(name, rel) : join(BOTS_DIR, name);
      if (!dirPath || !existsSync(dirPath) || !statSync(dirPath).isDirectory()) return send(404, { error: "directory not found" });
      const entries = readdirSync(dirPath, { withFileTypes: true })
        .filter((e) => !e.name.startsWith("."))
        .map((e) => { let s = null; try { s = statSync(join(dirPath, e.name)); } catch {}
          return { name: e.name, type: e.isDirectory() ? "dir" : "file", size: s?.size ?? 0, mtime: s?.mtime?.toISOString() ?? null }; })
        .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "dir" ? -1 : 1));
      return send(200, { path: rel, entries });
    }
    if (action === "chat" && rest[3] === "interrupt" && req.method === "POST") {
      const r = streamChat.interrupt(name);
      return send(r.error ? 400 : 202, r);
    }
    if (action === "chat" && rest[3] === "permission" && req.method === "POST") {
      const body = await readBody(req);
      const r = streamChat.answerPermission(name, body?.ref, body?.decision);
      return send(r.error ? 400 : 202, r);
    }
    if (action === "chat" && rest[3] === "history" && req.method === "GET") {
      const limit = Math.min(Math.max(Number(u.searchParams.get("limit") ?? 200) || 200, 1), 1000);
      return send(200, readHistory(BOTS_DIR, name, { limit }));   // shared format of both harness modes
    }
  }
  return send(404, { error: "unknown API route" });
}

// Path below the bot directory, without dot segments; null on an escape attempt
function safeBotPath(bot, rel) {
  if (rel.startsWith("/") || rel.split("/").some((s) => s.startsWith(".") || !s)) return null;
  const base = join(BOTS_DIR, bot);
  const full = resolve(base, rel);
  return full.startsWith(base + sep) ? full : null;
}

const UPLOAD_MAX = 25 * 1024 * 1024;
const safeFileName = (n) => (String(n ?? "file").split(/[\\/]/).pop().replace(/[^\w.\-äöüÄÖÜß ]+/g, "_").slice(0, 80) || "file");
function uploadFile(req, res, bot, u, send) {
  // Reject up front via the header – after req.destroy() mid-stream no response would get through
  if (Number(req.headers["content-length"] ?? 0) > UPLOAD_MAX) { req.resume(); return send(413, { error: "file too large (max. 25 MB)" }); }
  const dir = join(BOTS_DIR, bot, "uploads");
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-");
  const name = `${stamp}-${safeFileName(u.searchParams.get("filename"))}`;
  const file = join(dir, name);
  const out = createWriteStream(file);
  let size = 0, failed = false;
  const fail = (code, msg) => { if (failed) return; failed = true; out.destroy(); try { rmSync(file, { force: true }); } catch {} send(code, { error: msg }); };
  req.on("data", (d) => { size += d.length; if (size > UPLOAD_MAX) fail(413, "file too large (max. 25 MB)"); });
  req.on("error", () => fail(400, "upload aborted"));
  out.on("error", (e) => fail(500, `upload failed: ${e.message}`));
  out.on("finish", () => { if (!failed) send(200, { path: `uploads/${name}`, name, size }); });
  req.pipe(out);
}

// ---------- Static UI (frontend/dist; SPA with hash routing, /bots/<name>/ belongs to the proxy) ----------
const MIME = { html: "text/html; charset=utf-8", js: "text/javascript", css: "text/css", svg: "image/svg+xml", png: "image/png", ico: "image/x-icon", json: "application/json", webmanifest: "application/manifest+json", woff2: "font/woff2", txt: "text/plain",
  jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", pdf: "application/pdf", csv: "text/csv", md: "text/markdown" };
// Files a browser fetches WITHOUT the session cookie when the interface is installed as an app
// (manifest, icons, the service worker) – nothing secret in them, so they are served before the sign-in gate
const PUBLIC_FILES = /^\/bots\/(manifest\.webmanifest|sw\.js|icons\/[\w.-]+)$/;
function serveStatic(url, res, { spa = true } = {}) {
  if (!existsSync(FRONTEND_DIR)) return false;
  let p = url.split("?")[0];
  if (p === "/") { res.writeHead(302, { location: "/bots/" }); res.end(); return true; }
  if (p !== "/bots" && !p.startsWith("/bots/")) return false;
  p = p.slice("/bots".length) || "/";
  let file = resolve(FRONTEND_DIR, "." + p);
  if (file !== FRONTEND_DIR && !file.startsWith(FRONTEND_DIR + sep)) return false;
  if (!existsSync(file) || statSync(file).isDirectory()) { if (!spa) return false; file = join(FRONTEND_DIR, "index.html"); }
  if (!existsSync(file)) return false;
  const ext = file.split(".").pop();
  const name = file.split(sep).pop();
  // index.html never cached; the service worker and the manifest revalidated (an update must not wait a year);
  // everything else carries a content hash in its name
  const cache = name === "index.html" ? "no-store" : name === "sw.js" || name === "manifest.webmanifest" ? "no-cache" : "public, max-age=31536000, immutable";
  res.writeHead(200, { "content-type": MIME[ext === "webmanifest" ? "webmanifest" : ext] ?? "application/octet-stream", "cache-control": cache });
  res.end(readFileSync(file));
  return true;
}

// ---------- Fallback page (when no frontend build is in the image) ----------
async function indexPage() {
  const live = await agentList();
  const rows = bots().map((b) => {
    const st = live.find((x) => x.name === b.name)?.status ?? "stopped";
    return `<li class="bot">
      <div class="head"><span class="dot ${esc(st)}"></span><strong>${esc(b.name)}</strong> <span class="st">${esc(st)}</span></div>
      <div class="role">${esc(b.role ?? "")}</div>
      <div class="actions">${b.display ? `<a class="btn" href="${watchPath(b)}">Watch</a>` : `<span class="st">no desktop</span>`}</div>
    </li>`;
  }).join("\n");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>metor</title>
<style>
 body{font:16px/1.4 -apple-system,system-ui,sans-serif;margin:0;background:#f6f6f4;color:#1b1b1b}
 header{padding:20px 24px;background:#fff;border-bottom:1px solid #e3e3df}
 h1{margin:0;font-size:20px} h1 small{font-weight:400;color:#777;margin-left:8px}
 ul{list-style:none;padding:16px 24px;margin:0;max-width:720px}
 .bot{background:#fff;border:1px solid #e3e3df;border-radius:12px;padding:14px 16px;margin-bottom:12px}
 .head{display:flex;align-items:center;gap:8px} .st{color:#777;font-size:14px}
 .dot{width:10px;height:10px;border-radius:50%;background:#bbb;display:inline-block}
 .dot.idle{background:#3aa657}.dot.busy,.dot.waiting{background:#e0a100}
 .role{color:#555;margin:6px 0 10px}
 .btn{display:inline-block;padding:8px 14px;border-radius:8px;background:#1b1b1b;color:#fff;text-decoration:none}
 footer{padding:12px 24px;color:#999;font-size:13px}
</style></head><body>
<header><h1>metor <small>${bots().length} bots</small></h1></header>
<ul>${rows || "<li>no bots</li>"}</ul>
<footer>Watch opens the bot's desktop (noVNC). Chat with the bots: Claude Desktop / Claude app.</footer>
</body></html>`;
}

// ---------- Proxy to the bot desktops (unchanged since the desktop was introduced) ----------
function target(url) {
  const m = /^\/bots\/([a-z0-9][a-z0-9-]{0,39})(\/.*)?$/.exec(url);
  if (!m || RESERVED.has(m[1])) return null;
  const b = bots().find((x) => x.name === m[1]);
  if (!b?.display) return null;
  // /bots/<name>/terminal… → the bot's ttyd (terminal tab); everything else → websockify/noVNC
  const port = /^\/terminal(\/|$)/.test(m[2] ?? "") ? 7100 + b.display : 6000 + b.display;
  return { port, path: url, bot: b };
}

// ---------- Sign-in (ADR-0012): redeem a setup/pairing claim, then gate everything behind the session ----------
function readForm(req) {
  return new Promise((done) => {
    let buf = ""; req.on("data", (d) => { buf += d; if (buf.length > 4096) { req.destroy(); done({}); } });
    req.on("end", () => done(Object.fromEntries(new URLSearchParams(buf)))); req.on("error", () => done({}));
  });
}
function redeemAndRedirect(req, res, claim) {
  const ip = clientIp(req);
  const page = (code, error) => { res.writeHead(code, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }); res.end(signInPage({ error })); };
  if (tooManyAttempts(ip)) return page(429, "Too many attempts – please wait ten minutes.");
  const r = claimSession(claim, { userAgent: req.headers["user-agent"], ip });
  if (!r) { noteFailure(ip); return page(401, "This link or code is invalid or has expired."); }
  console.log(`auth: new session ${r.session.id} (${r.session.name}, via ${r.session.via})`);
  res.writeHead(302, { location: "/bots/", "set-cookie": setCookieHeader(r.secret, req), "cache-control": "no-store" }); res.end();
}

const server = http.createServer(async (req, res) => {
  try {
    const url = req.url ?? "/";
    const path = url.split("?")[0];
    if (path === "/bots/auth/claim" && req.method === "GET") return redeemAndRedirect(req, res, { token: new URL(url, "http://gateway").searchParams.get("token") });
    if (path === "/bots/auth/code" && req.method === "POST") return redeemAndRedirect(req, res, { code: (await readForm(req)).code });
    if ((req.method === "GET" || req.method === "HEAD") && PUBLIC_FILES.test(path) && serveStatic(url, res, { spa: false })) return;
    if (!AUTH_OFF && !sessionOf(req)) {
      if (path === "/bots/api" || path.startsWith("/bots/api/")) { res.writeHead(401, { "content-type": "application/json", "cache-control": "no-store" }); return res.end(JSON.stringify({ error: "not signed in" })); }
      res.writeHead(401, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }); return res.end(signInPage());
    }
    if (url === "/bots/api" || url.startsWith("/bots/api/")) return await api(req, res, url);
    const t = target(url);
    if (t) {
      const up = http.request({ host: "127.0.0.1", port: t.port, method: req.method, path: t.path, headers: req.headers }, (r) => {
        // Watch cookie for the WebSocket authorization: browsers (esp. Firefox/Safari) do NOT send
        // basic auth with WS handshakes – Caddy therefore lets WS through without login (see Caddyfile),
        // and the upgrade handler demands this cookie instead. It only originates here, i.e.
        // only via a page fetch that has already passed the login.
        const headers = { ...r.headers };
        if (t.bot.watchToken) {
          const prev = headers["set-cookie"] ? [].concat(headers["set-cookie"]) : [];
          headers["set-cookie"] = [...prev, `metor_watch_${t.bot.name}=${t.bot.watchToken}; Path=/bots/${t.bot.name}; SameSite=Strict; HttpOnly`];
          // Never cache HTML: if vnc.html/terminal came from the browser cache, the
          // Set-Cookie step would be missing and the subsequent WebSocket would be rejected
          if (String(headers["content-type"] ?? "").includes("text/html")) headers["cache-control"] = "no-store";
        }
        res.writeHead(r.statusCode ?? 502, headers); r.pipe(res);
      });
      up.on("error", () => { res.writeHead(502, { "content-type": "text/plain" }); res.end("bot desktop not reachable"); });
      return req.pipe(up);
    }
    if (serveStatic(url, res)) return;
    if (url === "/" || url === "/bots" || url === "/bots/") { res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }); return res.end(await indexPage()); }
    res.writeHead(404, { "content-type": "text/plain" }); res.end("unknown bot");
  } catch (e) {
    try { res.writeHead(500, { "content-type": "text/plain" }); res.end(`gateway error: ${e.message}`); } catch {}
  }
});
// Pass WebSocket (noVNC ↔ websockify, terminal ↔ ttyd) through transparently.
// Access: a valid watch cookie is required (comes from the HTTP proxy above, only after Caddy login) –
// this replaces basic_auth for WS handshakes, where browsers don't send credentials.
server.on("upgrade", (req, socket, head) => {
  const t = target(req.url ?? "/");
  if (!t) return socket.destroy();
  if (!AUTH_OFF && !sessionOf(req)) return socket.destroy();   // the session cookie travels with the handshake
  const cookies = String(req.headers.cookie ?? "").split(/;\s*/);
  if (!t.bot.watchToken || !cookies.includes(`metor_watch_${t.bot.name}=${t.bot.watchToken}`)) return socket.destroy();
  const up = net.connect(t.port, "127.0.0.1", () => {
    const lines = [`${req.method} ${t.path} HTTP/1.1`, ...Object.entries(req.headers).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : v}`), "", ""];
    up.write(lines.join("\r\n")); if (head.length) up.write(head);
    socket.pipe(up); up.pipe(socket);
  });
  up.on("error", () => socket.destroy()); socket.on("error", () => up.destroy());
});
server.listen(PORT, "0.0.0.0", () => console.log(`metor gateway: http://0.0.0.0:${PORT}/bots/  (base: ${BASE || "-"}, frontend: ${existsSync(FRONTEND_DIR) ? FRONTEND_DIR : "fallback page"})`));
