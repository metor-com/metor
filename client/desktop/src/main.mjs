// metor desktop – the Electron shell around the interface (ADR-0015).
// The renderer is the unchanged interface build (ui/), served from the app's own origin
// app://metor. Every request to a connected computer gets that computer's session token added
// here, in the main process, so the page never holds it. Native parts only: connecting and the
// keychain, tray and menus, notifications, screen capture, the metor:// link, the updater.
import { app, BrowserWindow, Menu, Notification, Tray, desktopCapturer, dialog, ipcMain, nativeImage, net, protocol, safeStorage, session, shell } from "electron";
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import updater from "electron-updater";

const here = dirname(fileURLToPath(import.meta.url));
const UI_DIR = resolve(here, "..", "ui");
const UI_URL = "app://metor/bots/";
const PRELOAD = join(here, "preload.cjs");
// --flag=value arguments of our own (a packaged app gets them from the command line too)
const argv = Object.fromEntries(process.argv.slice(1).filter((a) => a.startsWith("--")).map((a) => { const i = a.indexOf("="); return i > 0 ? [a.slice(2, i), a.slice(i + 1)] : [a.slice(2), true]; }));
if (argv["user-data-dir"]) app.setPath("userData", resolve(String(argv["user-data-dir"])));

// ---------- Computers: origin, name and the session secret (encrypted with the OS keychain) ----------
const storeFile = () => join(app.getPath("userData"), "computers.json");
let db = null;
function load() { if (!db) { try { db = { computers: [], current: null, ...JSON.parse(readFileSync(storeFile(), "utf8")) }; } catch { db = { computers: [], current: null }; } } return db; }
function save() { mkdirSync(dirname(storeFile()), { recursive: true }); const tmp = `${storeFile()}.tmp`; writeFileSync(tmp, JSON.stringify(db, null, 2) + "\n", { mode: 0o600 }); renameSync(tmp, storeFile()); }
// Without an OS keychain (a Linux desktop without a keyring) the secret is kept in the clear – said out loud, not silently
let warnedPlain = false;
const encrypt = (s) => {
  if (safeStorage.isEncryptionAvailable()) return `enc:${safeStorage.encryptString(s).toString("base64")}`;
  if (!warnedPlain) { warnedPlain = true; console.warn(`metor: no OS keychain available – the session secret is stored unencrypted in ${storeFile()}`); }
  return `raw:${s}`;
};
const decrypt = (v) => { try { return v?.startsWith("enc:") ? safeStorage.decryptString(Buffer.from(v.slice(4), "base64")) : v?.startsWith("raw:") ? v.slice(4) : null; } catch { return null; } };
const secrets = new Map();   // id → session secret, decrypted once
function secretOf(id) { if (!id) return null; if (!secrets.has(id)) { const c = load().computers.find((x) => x.id === id); secrets.set(id, c?.secret ? decrypt(c.secret) : null); } return secrets.get(id); }
const computer = (id) => load().computers.find((c) => c.id === id) ?? null;
// The session is gone (401 from the computer): keep the entry, drop the secret
function dropSecret(id) { const c = computer(id); if (c?.secret) { delete c.secret; secrets.set(id, null); save(); } }
// What the app has learned about a computer: the unread total (the overview's badge) and whether it answers
const status = new Map();   // id → { unread, reachable }
const unreadOf = (list) => list.reduce((n, a) => n + (Number(a.unread) || 0), 0);
function setStatus(id, patch) {
  const before = status.get(id) ?? { unread: null, reachable: null }, after = { ...before, ...patch };
  if (before.unread === after.unread && before.reachable === after.reachable) return;
  status.set(id, after); broadcast("metor:computers", load().computers.map(publicInfo));
}
// `short` is the name where the context already says "bots' computer" (the overview, the head of the bot list): "This Mac"
const publicInfo = (c) => (c ? { id: c.id, name: c.label || (isLocal(c.origin) ? nameFor(c.origin) : c.name), short: c.label || (isLocal(c.origin) ? shortFor(c.origin) : c.name),
  origin: c.origin, version: c.version ?? null, signedIn: !!secretOf(c.id), local: isLocal(c.origin), unread: status.get(c.id)?.unread ?? null, reachable: status.get(c.id)?.reachable ?? null } : null);
// Which computer a request goes to – WebSocket URLs (ws:, wss:) belong to the http(s) origin they came from
function computerForUrl(u) {
  try { const x = new URL(u), secure = x.protocol === "https:" || x.protocol === "wss:"; return load().computers.find((c) => { const o = new URL(c.origin); return o.host === x.host && (o.protocol === "https:") === secure; }) ?? null; }
  catch { return null; }
}
const deviceLabel = () => `metor app on ${{ darwin: "Mac", win32: "Windows", linux: "Linux" }[process.platform] ?? process.platform}`;
// Names: a computer on this machine is always "Bots' computer on this Mac" (never "this machine" – that is the user's device,
// see the glossary); remote ones carry their host name. The local name is derived on every read, so older entries follow.
const MACHINE = process.platform === "darwin" ? "this Mac" : "this machine";
const isLocal = (origin) => /^https?:\/\/(127\.0\.0\.1|localhost)(:|$)/.test(origin);
// Plain http only where the wire is the user's own: this machine, the local network, a .local name.
// Anywhere else the claim and then the session secret would cross the internet in the clear
const PRIVATE_HOST = /^(localhost|127\.\d+\.\d+\.\d+|\[::1\]|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|[^.]+\.local)$/i;
const insecureOrigin = (origin) => { try { const u = new URL(origin); return u.protocol === "http:" && !PRIVATE_HOST.test(u.hostname); } catch { return true; } };
const portSuffix = (origin) => { try { const p = new URL(origin).port; return p && p !== "6010" ? ` (:${p})` : ""; } catch { return ""; } };
const nameFor = (origin) => { try { return isLocal(origin) ? `Bots' computer on ${MACHINE}${portSuffix(origin)}` : new URL(origin).hostname; } catch { return origin; } };
const shortFor = (origin) => `${MACHINE[0].toUpperCase()}${MACHINE.slice(1)}${portSuffix(origin)}`;

async function fetchJson(url, init = {}, ms = 8000) {
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), ms);
  try { const r = await net.fetch(url, { ...init, signal: ac.signal }); return { ok: r.ok, status: r.status, data: await r.json().catch(() => null) }; }
  finally { clearTimeout(t); }
}
// Connect: a setup link, a pairing link or a pairing code (ADR-0012) becomes a session of this app.
// The link carries the computer's address; a code needs the address typed next to it.
async function connect({ url = "", claim = "" } = {}) {
  let origin = null, token = null, code = null;
  const s = String(claim ?? "").trim();
  try {
    const u = new URL(s);
    if (u.protocol === "metor:") { origin = u.searchParams.get("url"); token = u.searchParams.get("token"); code = u.searchParams.get("code"); }
    else if (/^https?:$/.test(u.protocol)) { origin = u.origin; token = u.searchParams.get("token"); }
    else return { ok: false, error: "That link is not a metor link." };
  } catch { if (/^[a-z2-9]{4}-?[a-z2-9]{4}$/i.test(s)) code = s; else if (s) token = s; }
  if (!origin && url) { try { origin = new URL(/^[a-z]+:\/\//i.test(url) ? url : `https://${url}`).origin; } catch { return { ok: false, error: "The address is not a URL." }; } }
  if (!origin) return { ok: false, error: "Enter the address of the bots' computer." };
  if (insecureOrigin(origin)) return { ok: false, error: `${origin} is plain http on the internet – the session would travel unencrypted. Use https, or a computer on this machine or your local network.` };
  if (!token && !code) return { ok: false, error: "Enter a setup link, a pairing link or a pairing code." };
  let v; try { v = await fetchJson(`${origin}/bots/api/version`); } catch (e) { return { ok: false, error: `No answer from ${origin} (${e.message}).` }; }
  if (!v.ok || v.data?.name !== "metor") return { ok: false, error: `No bots' computer of metor answers at ${origin}.` };
  if (!v.data.capabilities?.redeem) return { ok: false, error: `The bots' computer at ${origin} is too old for the app – update it to 0.2 or newer.` };
  let r; try { r = await fetchJson(`${origin}/bots/api/auth/redeem`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token, code, name: deviceLabel() }) }); }
  catch (e) { return { ok: false, error: e.message }; }
  if (!r.ok || !r.data?.secret) return { ok: false, error: r.data?.error ?? `HTTP ${r.status}` };
  const d = load();
  let c = d.computers.find((x) => x.origin === origin);
  if (!c) { c = { id: randomBytes(6).toString("hex"), origin, name: nameFor(origin), createdAt: Date.now() }; d.computers.push(c); }
  c.secret = encrypt(r.data.secret); c.session = r.data.session; c.version = v.data.version;
  secrets.set(c.id, r.data.secret); d.current = c.id; save();
  return { ok: true, id: c.id };
}
// Forget a computer: sign the session out there (best effort), then drop it here
async function forget(id) {
  const c = computer(id); if (!c) return;
  const s = secretOf(id);
  if (s) { try { await fetchJson(`${c.origin}/bots/api/auth/logout`, { method: "POST", headers: { authorization: `Bearer ${s}` } }, 4000); } catch {} }
  const d = load(); d.computers = d.computers.filter((x) => x.id !== id); if (d.current === id) d.current = d.computers[0]?.id ?? null; secrets.delete(id); status.delete(id); save();
}
// Ask a computer for its bot list: does it answer, how much is unread (the overview probes all of them when it opens)
async function probe(c) {
  const s = secretOf(c.id);
  if (!s) return setStatus(c.id, { unread: null, reachable: await reachable(c.origin) });
  try {
    const r = await fetchJson(`${c.origin}/bots/api/agents`, { headers: { authorization: `Bearer ${s}` } }, 5000);
    if (r.status === 401) { dropSecret(c.id); refreshMenus(); return setStatus(c.id, { unread: null, reachable: true }); }
    setStatus(c.id, r.ok && Array.isArray(r.data) ? { unread: unreadOf(r.data), reachable: true } : { reachable: r.ok });
  } catch { setStatus(c.id, { reachable: false }); }
}

// ---------- The app's own watch on every signed-in computer ----------
// One event stream per computer: `agents` for the unread counts (the overview's badges), `notify` for
// the notifications of a computer no window shows – the renderer handles those of its own computer.
// The desktop app has no push, so this is how a computer the user is not looking at gets heard.
const watches = new Map();   // id → { topics, ac }
function syncWatches() {
  for (const c of load().computers) {
    const want = secretOf(c.id) ? ["agents", ...(windowShowing(c.id) ? [] : ["notify"])].join(",") : null;
    const w = watches.get(c.id);
    if (w && w.topics === want) continue;
    if (w) { w.ac.abort(); watches.delete(c.id); }
    if (want) watch(c.id, want);
  }
  for (const [id, w] of watches) if (!computer(id)) { w.ac.abort(); watches.delete(id); }
}
async function watch(id, topics) {
  const ac = new AbortController(); watches.set(id, { topics, ac });
  let backoff = 2000;
  while (!ac.signal.aborted) {
    const c = computer(id), s = secretOf(id); if (!c || !s) break;
    try {
      const res = await net.fetch(`${c.origin}/bots/api/events?topics=${topics}`, { headers: { authorization: `Bearer ${s}`, accept: "text/event-stream" }, cache: "no-store", signal: ac.signal });
      if (res.status === 401) { dropSecret(id); refreshMenus(); break; }
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      backoff = 2000; setStatus(id, { reachable: true });
      await readEvents(res.body, ac.signal, (event, data) => {
        if (event === "agents") { try { setStatus(id, { unread: unreadOf(JSON.parse(data)), reachable: true }); } catch {} }
        else if (event === "notify") { try { notifyFrom(id, JSON.parse(data)); } catch {} }
      });
    } catch {}
    if (ac.signal.aborted) break;
    setStatus(id, { reachable: false });
    await new Promise((r) => setTimeout(r, backoff)); backoff = Math.min(backoff * 2, 30_000);
  }
  if (watches.get(id)?.ac === ac) watches.delete(id);
}
// A minimal server-sent-events reader: `event:` and `data:` lines, a blank line ends an event
async function readEvents(body, signal, onEvent) {
  const reader = body.getReader(), dec = new TextDecoder();
  let buf = "", event = "message", data = [];
  for (;;) {
    const { value, done } = await reader.read(); if (done || signal.aborted) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).replace(/\r$/, ""); buf = buf.slice(i + 1);
      if (line === "") { if (data.length) onEvent(event, data.join("\n")); event = "message"; data = []; continue; }
      if (line.startsWith(":")) continue;
      const j = line.indexOf(":"), field = j < 0 ? line : line.slice(0, j), val = j < 0 ? "" : line.slice(j + 1).replace(/^ /, "");
      if (field === "event") event = val; else if (field === "data") data.push(val);
    }
  }
}
// A notification from a computer no window shows: named after the computer, a click brings its bot to the front
function notifyFrom(id, n = {}) {
  const c = computer(id); if (!c || !Notification.isSupported()) return;
  if (argv["trace-requests"]) console.log(`notify from ${publicInfo(c).name}: ${n.title} – ${String(n.body ?? "").slice(0, 60)} (${n.bot})`);
  const note = new Notification({ title: String(n.title ?? "metor").slice(0, 100), body: String(n.body ?? "").slice(0, 300), subtitle: publicInfo(c).name });
  note.on("click", () => openBot(id, n.bot ? String(n.bot) : null));
  note.show();
}

// ---------- Windows: one computer per window (null = the connect screen) ----------
const windows = new Map();   // BrowserWindow → computer id
const unreachable = new Map();   // BrowserWindow → the computer that did not answer when the window loaded
const currentOf = (win) => windows.get(win) ?? null;
// Does the computer answer? Checked before its interface is loaded, so a stopped computer lands on the
// connect screen (with the reason and, for a local one, the Start button) instead of a dead interface
async function reachable(origin) {
  try { const r = await fetchJson(`${origin}/bots/api/version`, {}, 3000); return r.ok && r.data?.name === "metor"; } catch { return false; }
}
// After a start the gateway needs a few seconds – wait for it before the interface is loaded
async function waitReachable(origin, ms = 90_000) {
  const until = Date.now() + ms;
  while (Date.now() < until) { if (await reachable(origin)) return true; await new Promise((r) => setTimeout(r, 1500)); }
  return false;
}
async function loadInterface(win, id, bot = null) {
  const c = computer(id);
  unreachable.delete(win);
  if (c && !(await reachable(c.origin))) unreachable.set(win, c.id);
  if (!win.isDestroyed()) win.loadURL(bot ? `${UI_URL}#/${bot}` : UI_URL);   // with a bot: its chat open (bot names are [a-z0-9-]; --open may add ?doc=<file>)
  syncWatches();
}
function show(win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); }
const WINDOW = /^(\d+)x(\d+)$/.exec(String(argv.window ?? ""));   // --window=WxH: a window size for snapshots
function openWindow(id = null, bot = null) {
  const win = new BrowserWindow({
    width: WINDOW ? Number(WINDOW[1]) : 1280, height: WINDOW ? Number(WINDOW[2]) : 820, minWidth: 720, minHeight: 480, title: "metor", show: false, backgroundColor: "#f4f4f5",
    webPreferences: { preload: PRELOAD, sandbox: true, contextIsolation: true, nodeIntegration: false, spellcheck: true },
  });
  windows.set(win, id);
  if (id) setCurrent(id);
  win.once("ready-to-show", () => win.show());
  win.on("closed", () => { windows.delete(win); unreachable.delete(win); syncWatches(); });
  // The window itself only ever shows the interface: links go to openLink (a window of the app for a
  // connected computer, the system browser for everything else)
  win.webContents.setWindowOpenHandler(({ url }) => { openLink(url); return { action: "deny" }; });
  win.webContents.on("will-navigate", (e, url) => { if (!url.startsWith(UI_URL)) { e.preventDefault(); openLink(url); } });
  loadInterface(win, id, bot);
  return win;
}
// A link: to a connected computer (a file a bot made, a page it wrote, its desktop) it opens in a plain
// window of the app, because the session token travels only with the app's requests – the system
// browser would show "not signed in". Any other link goes to the system browser.
function openLink(url) {
  if (!/^https?:/.test(String(url))) return;
  if (!computerForUrl(url)) { shell.openExternal(url); return; }
  const w = new BrowserWindow({ width: 1000, height: 760, title: "metor", backgroundColor: "#ffffff",
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  w.webContents.setWindowOpenHandler(({ url: u }) => { openLink(u); return { action: "deny" }; });
  w.loadURL(url);
}
function switchWindow(win, id, bot = null) { windows.set(win, id); if (id) setCurrent(id); loadInterface(win, id, bot); }
// The current computer: the one shown last (opened, switched to or focused) – persisted, so the app
// opens with it again, and ticked in the menus
function setCurrent(id) { const d = load(); if (d.current !== id) { d.current = id; save(); } }
const selectedComputer = () => currentOf(BrowserWindow.getFocusedWindow() ?? null) ?? load().current ?? null;
// The window that shows a computer's interface right now (one on the connect screen waiting for it does not count)
const windowShowing = (id, except = null) => [...windows].find(([w, cid]) => w !== except && cid === id && !w.isDestroyed() && unreachable.get(w) !== id)?.[0] ?? null;
// Bring a computer to the front: a window that shows it already wins – no second window for the same
// computer – and a mere connect-screen window that asked for it closes; otherwise this window takes it
function showComputer(win, id) {
  const other = windowShowing(id, win);
  if (other) { show(other); if (win && !win.isDestroyed() && currentOf(win) === null) win.close(); return other; }
  if (!win || win.isDestroyed()) return openWindow(id);
  switchWindow(win, id); show(win); return win;
}
function focusOrOpen(id) { const w = id && windowShowing(id); if (w) show(w); else openWindow(id); }
// A bot of that computer to the front (a click on its notification): the window showing the computer, else the
// focused window switches to it with the bot's chat open, else a new window
function openBot(id, bot = null) {
  const w = windowShowing(id);
  if (w) { show(w); if (bot) w.webContents.send("metor:open-bot", bot); return; }
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows().find((x) => !x.isDestroyed()) ?? null;
  if (!win) return openWindow(id, bot);
  switchWindow(win, id, bot); show(win);
}

// ---------- A local computer through the host command (metor setup / box up / box down) ----------
// The `metor` wrapper drives Docker or Apple's `container`; the app only calls it. A packaged app
// carries its own copy (resources/metor), development uses the checkout; a Homebrew one is a fallback.
// Apps started from the Finder carry a minimal PATH, so Homebrew's is added for the runtime CLIs.
const BUNDLED_WRAPPER = app.isPackaged ? join(process.resourcesPath, "metor") : resolve(here, "..", "..", "..", "backend", "harness", "bin", "metor");
const WRAPPER_CANDIDATES = [process.env.METOR_CLI, BUNDLED_WRAPPER, "/opt/homebrew/bin/metor", "/usr/local/bin/metor", join(app.getPath("home"), ".local", "bin", "metor")].filter(Boolean);
const wrapper = () => WRAPPER_CANDIDATES.find((p) => existsSync(p)) ?? null;
const localComputer = () => load().computers.find((c) => isLocal(c.origin)) ?? null;
const LINK_RE = /https?:\/\/\S+\/bots\/auth\/claim\?token=[\w-]+/;
const broadcast = (channel, data) => { for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(channel, data); };
function wrapperEnv(id = null) {
  const env = { ...process.env, PATH: `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH ?? "/usr/bin:/bin"}` };
  const c = (id && computer(id)) || localComputer(); let port = null; try { port = c && new URL(c.origin).port; } catch {}
  if (port && !env.METOR_PORT) env.METOR_PORT = port;   // the port the local computer was set up with
  return env;
}
// Runs the host command; unless quiet, every output line goes to the windows (the connect screen shows them)
function runWrapper(args, { quiet = false, ms = 20 * 60_000, id = null } = {}) {
  return new Promise((done) => {
    const w = wrapper(); if (!w) return done({ ok: false, out: "The metor command is missing." });
    let out = "";
    const child = spawn(w, args, { env: wrapperEnv(id), stdio: ["ignore", "pipe", "pipe"] });
    const timer = setTimeout(() => child.kill(), ms);
    const onData = (d) => { const t = String(d); out += t; if (!quiet) for (const line of t.split(/\r?\n/)) if (line.trim()) broadcast("metor:local-progress", { line: line.trim() }); };
    child.stdout.on("data", onData); child.stderr.on("data", onData);
    child.on("error", (e) => { clearTimeout(timer); done({ ok: false, out: `${out}\n${e.message}`.trim() }); });
    child.on("close", (code) => { clearTimeout(timer); done({ ok: code === 0, out: out.trim() }); });
  });
}
// What the connect screen needs to know: is a local computer possible, does one exist, is it running
async function localStatus() {
  const c = localComputer();
  if (!wrapper()) return { wrapper: false, runtime: null, state: "unknown", platform: process.platform, computer: publicInfo(c) };
  const r = await runWrapper(["box", "state"], { quiet: true, ms: 30_000 });
  const [state, runtime] = (r.ok ? r.out.trim().split("\n").pop() : "unknown").split(/\s+/);
  return { wrapper: true, runtime: runtime ?? null, state: state === "none" ? "no-runtime" : state, platform: process.platform, computer: publicInfo(c) };
}
let localBusy = false;
async function localAction(action, win = null, id = null) {
  const args = { setup: ["setup", "--no-open"], up: ["box", "up"], down: ["box", "down"] }[action];
  if (!args) return { ok: false, error: `unknown action ${action}` };
  if (localBusy) return { ok: false, error: `The bots' computer on ${MACHINE} is busy – wait for the running step to finish.` };
  localBusy = true; broadcast("metor:local-progress", { start: action, line: `metor ${args.join(" ")}` });
  const r = await runWrapper(args, { id });
  localBusy = false;
  const tail = r.out.split("\n").filter(Boolean).slice(-6).join("\n");
  const finish = (ok, error = null) => { broadcast("metor:local-progress", { done: action, ok, error }); refreshMenus(); return ok ? { ok, tail } : { ok, error }; };
  if (!r.ok) return finish(false, tail || `metor ${args.join(" ")} failed`);
  if (action === "setup") {
    const link = LINK_RE.exec(r.out)?.[0]; if (!link) return finish(false, "The setup printed no link.");
    const c = await connect({ claim: link }); if (!c.ok) return finish(false, c.error);
    showComputer(win ?? BrowserWindow.getAllWindows()[0] ?? null, c.id);
  } else if (action === "up") {
    const c = (id && computer(id)) || localComputer();   // windows on the connect screen, or waiting for this computer, show it once it answers
    if (c && secretOf(c.id)) {
      broadcast("metor:local-progress", { line: "waiting for the interface…" });
      if (!(await waitReachable(c.origin))) return finish(false, `The bots' computer started, but its interface at ${c.origin} does not answer – see: metor box logs`);
      for (const [w, cid] of [...windows]) if (cid === null || (cid === c.id && unreachable.get(w) === c.id)) showComputer(w, c.id);
    }
  } else if (action === "down") {
    const c = localComputer();   // windows on the stopped computer go to the connect screen (which offers Start)
    if (c) for (const [w, cid] of windows) if (cid === c.id) switchWindow(w, null);
  }
  return finish(true);
}
async function menuLocal(action) {
  const r = await localAction(action);
  if (!r.ok) dialog.showErrorBox("metor", r.error);
  else if (action !== "setup") new Notification({ title: "metor", body: r.tail.split("\n").pop() || `Bots' computer on ${MACHINE}: ${action}` }).show();
}
// The local computer comes back with the app (Apple's runtime has no restart policy) unless switched off in the menu
async function autostartLocal() {
  if (load().autostartLocal === false || !localComputer() || !wrapper()) return;
  const st = await localStatus(); if (st.state !== "stopped") return;
  const r = await localAction("up"); if (!r.ok) console.error(`autostart: ${r.error}`);
}
const localItems = () => (wrapper() ? [{ label: `Bots' computer on ${MACHINE}`, submenu: [
  { label: "Set up…", click: () => menuLocal("setup") },
  { label: "Start", click: () => menuLocal("up") },
  { label: "Stop", click: () => menuLocal("down") },
  { type: "separator" },
  { label: "Start automatically when the app opens", type: "checkbox", checked: load().autostartLocal !== false, click: (item) => { load().autostartLocal = item.checked; save(); } },
] }, { type: "separator" }] : []);

// ---------- Tray and menus ----------
let tray = null;
function computerItems() {
  const list = load().computers, selected = selectedComputer();
  return list.length ? list.map((c) => ({ label: publicInfo(c).name, type: "radio", checked: c.id === selected, click: () => focusOrOpen(c.id) })) : [{ label: "No bots' computer connected", enabled: false }];
}
function refreshMenus() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform === "darwin" ? [{ role: "appMenu" }] : []),
    { label: "Computers", submenu: [{ label: "Connect a bots' computer…", click: () => openWindow(null) }, { type: "separator" }, ...localItems(), ...computerItems()] },
    { role: "editMenu" }, { role: "viewMenu" }, { role: "windowMenu" },
  ]));
  tray?.setContextMenu(Menu.buildFromTemplate([
    { label: "Open metor", click: () => focusOrOpen(load().current ?? load().computers[0]?.id ?? null) },
    { type: "separator" }, ...computerItems(), { label: "Connect a bots' computer…", click: () => openWindow(null) },
    { type: "separator" }, ...localItems(), { label: "Quit metor", role: "quit" },
  ]));
  syncWatches();   // called after every change to the computers and the windows – the watches follow
}

// ---------- Links: metor://connect?url=…&token=… or a pasted setup/pairing link ----------
async function handleLink(link) {
  const r = await connect({ claim: link });
  const win = BrowserWindow.getAllWindows()[0] ?? openWindow(null);
  if (r.ok) showComputer(win, r.id); else { dialog.showErrorBox("metor", r.error); show(win); }
  refreshMenus();
}
const isLink = (a) => /^(metor:|https?:)/.test(a);
if (!app.requestSingleInstanceLock()) app.quit();
// A second launch hands its link to the running app: a metor:// or https link, or `--connect=<link>`
app.on("second-instance", (_e, args) => { const link = args.find(isLink) ?? args.find((a) => a.startsWith("--connect="))?.slice("--connect=".length); if (link) handleLink(link); else { const w = BrowserWindow.getAllWindows()[0]; if (w) show(w); else openWindow(load().current); } });
app.on("open-url", (e, link) => { e.preventDefault(); if (app.isReady()) handleLink(link); else app.whenReady().then(() => handleLink(link)); });

// ---------- IPC for the preload API (window.metor) ----------
// Only the interface's own frame may call in – the preload runs there alone, and every handler checks
// the sender's frame as well, so a screen or terminal frame from a computer can never reach these
const fromUi = (e) => String(e.senderFrame?.url ?? "").startsWith(UI_URL);
const handle = (channel, fn) => ipcMain.handle(channel, (e, ...args) => (fromUi(e) ? fn(e, ...args) : undefined));
const on = (channel, fn) => ipcMain.on(channel, (e, ...args) => { if (fromUi(e)) fn(e, ...args); else if ("returnValue" in e) e.returnValue = null; });
on("metor:info", (e) => {
  const win = BrowserWindow.fromWebContents(e.sender); const c = computer(currentOf(win)); const info = publicInfo(c);
  if (info && unreachable.get(win) === c.id) info.reachable = false;   // the connect screen says so and offers Try again / Start
  e.returnValue = { platform: process.platform, version: app.getVersion(), gateway: info };
});
handle("metor:gateways", async (_e, opts) => { if (opts?.probe) await Promise.all(load().computers.map(probe)); return load().computers.map(publicInfo); });
handle("metor:rename", (_e, id, name) => {   // the user's own name for a computer, kept here, never sent to it
  const c = computer(id); if (!c) return; const n = String(name ?? "").trim().slice(0, 60);
  if (n) c.label = n; else delete c.label;
  save(); refreshMenus(); broadcast("metor:computers", load().computers.map(publicInfo));
});
handle("metor:connect", async (e, args) => { const r = await connect(args ?? {}); if (r.ok) { showComputer(BrowserWindow.fromWebContents(e.sender), r.id); refreshMenus(); } return r; });
handle("metor:use", (e, id) => { if (computer(id)) showComputer(BrowserWindow.fromWebContents(e.sender), id); });
handle("metor:forget", async (_e, id) => { await forget(id); for (const [w, cid] of windows) if (cid === id) switchWindow(w, null); refreshMenus(); });
handle("metor:reorder", (_e, ids) => {   // the order of the computers menu, the user's own
  const order = Array.isArray(ids) ? ids.map(String) : [], pos = (c) => { const i = order.indexOf(c.id); return i < 0 ? order.length : i; };
  const d = load(); d.computers.sort((a, b) => pos(a) - pos(b)); save(); refreshMenus(); broadcast("metor:computers", d.computers.map(publicInfo));
});
handle("metor:local-status", () => localStatus());
// Download a file of a connected computer: Chromium's download with the session's request hook (the token),
// Electron's save dialog. The interface cannot do it with a plain link – across origins the download
// attribute is ignored and the link would navigate instead.
handle("metor:download", (e, url) => { if (computerForUrl(String(url))) e.sender.downloadURL(String(url)); });
handle("metor:local", (e, action, id) => localAction(String(action), BrowserWindow.fromWebContents(e.sender), id ? String(id) : null));
on("metor:signed-out", (e) => {
  const win = BrowserWindow.fromWebContents(e.sender); const c = computer(currentOf(win));
  if (c) dropSecret(c.id);
  win.loadURL(UI_URL); refreshMenus();
});
on("metor:notify", (e, n = {}) => {
  if (argv["trace-requests"]) console.log(`notify: ${n.title} – ${String(n.body ?? "").slice(0, 60)} (${n.bot})`);
  if (!Notification.isSupported()) return;
  const win = BrowserWindow.fromWebContents(e.sender);
  const note = new Notification({ title: String(n.title ?? "metor").slice(0, 100), body: String(n.body ?? "").slice(0, 300) });
  note.on("click", () => { if (win && !win.isDestroyed()) { show(win); if (n.bot) win.webContents.send("metor:open-bot", String(n.bot)); } });
  note.show();
});

// ---------- App ----------
protocol.registerSchemesAsPrivileged([{ scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
app.on("browser-window-focus", (_e, win) => { const id = currentOf(win); if (id) setCurrent(id); refreshMenus(); });
app.whenReady().then(async () => {
  // The interface from ui/ under app://metor/bots/ – the same paths the gateway serves, SPA fallback included
  protocol.handle("app", (req) => {
    const u = new URL(req.url);
    if (u.host !== "metor" || !(u.pathname === "/bots" || u.pathname.startsWith("/bots/"))) return new Response("not found", { status: 404 });
    let file = resolve(UI_DIR, `.${decodeURIComponent(u.pathname.slice("/bots".length)) || "/"}`);
    if (file !== UI_DIR && !file.startsWith(UI_DIR + sep)) return new Response("forbidden", { status: 403 });
    if (!existsSync(file) || statSync(file).isDirectory()) file = join(UI_DIR, "index.html");
    return net.fetch(pathToFileURL(file).toString());
  });
  const ses = session.defaultSession;
  // The session token, on every request to a connected computer: API, stream, uploads, the
  // screen and terminal frames and their WebSockets – the renderer sends plain requests
  ses.webRequest.onBeforeSendHeaders({ urls: ["<all_urls>"] }, (details, cb) => {
    const c = computerForUrl(details.url); const s = c && secretOf(c.id);
    if (s) details.requestHeaders.Authorization = `Bearer ${s}`;
    if (argv["trace-requests"]) console.log(`request: ${details.resourceType} ${details.method} ${details.url.slice(0, 120)} ${s ? "(token)" : ""}`);
    cb({ requestHeaders: details.requestHeaders });
  });
  // Permissions by who asks: the interface itself may use microphone, camera, clipboard, screen and
  // notifications; a frame from a connected computer (its screen, its terminal) gets the clipboard and
  // full screen only; any other page – a computer gone bad, a stray navigation – gets nothing
  const UI_PERMISSIONS = ["media", "notifications", "clipboard-read", "clipboard-sanitized-write", "display-capture", "fullscreen"];
  const FRAME_PERMISSIONS = ["clipboard-read", "clipboard-sanitized-write", "fullscreen"];
  ses.setPermissionRequestHandler((wc, permission, cb, details) => {
    const from = String(details?.requestingUrl ?? wc?.getURL?.() ?? "");
    const allowed = from.startsWith(UI_URL) ? UI_PERMISSIONS : computerForUrl(from) ? FRAME_PERMISSIONS : [];
    cb(allowed.includes(permission));
  });
  // Screen sharing for the bots, on a click in the interface only: the system picker where there is one
  // (macOS 15+), else the primary screen
  ses.setDisplayMediaRequestHandler(async (req, cb) => {
    if (!String(req.securityOrigin ?? "").startsWith("app://metor") || !req.userGesture) return cb({});
    try { const sources = await desktopCapturer.getSources({ types: ["screen"] }); cb(sources.length ? { video: sources[0] } : {}); } catch { cb({}); }
  }, { useSystemPicker: true });

  if (app.isPackaged) { try { app.setAsDefaultProtocolClient("metor"); } catch {} }
  try { tray = new Tray(nativeImage.createFromPath(join(here, "assets", "tray.png"))); tray.setToolTip("metor"); tray.on("click", () => focusOrOpen(load().current)); } catch (e) { console.error("tray:", e.message); }
  refreshMenus();

  let id = load().current ?? load().computers[0]?.id ?? null;
  if (argv.connect) { const r = await connect({ claim: String(argv.connect) }); if (r.ok) id = r.id; else console.error(`connect: ${r.error}`); refreshMenus(); }
  // --connect-screen: start like "Connect a bots' computer…"; --open=<bot>: start with that bot's chat open (or --open=computers)
  const win = openWindow(argv["connect-screen"] ? null : id, argv.open ? String(argv.open) : null);
  if (argv.local) { const r = await localAction(String(argv.local), win); console.log(`local ${argv.local}: ${r.ok ? "ok" : `failed – ${r.error}`}`); }
  else autostartLocal().catch((e) => console.error("autostart:", e.message));
  let extra = null;   // --also-connect-screen: a second window on the connect screen (with --open2=connect/local|remote), for tests
  if (argv["also-connect-screen"]) { extra = openWindow(null); if (argv.open2) extra.loadURL(`${UI_URL}#/${argv.open2}`); }
  // Development aid: --snapshot=<file.png> captures the window after loading and quits
  if (argv.snapshot) win.webContents.once("did-finish-load", () => setTimeout(async () => {
    try { writeFileSync(String(argv.snapshot), (await win.webContents.capturePage()).toPNG()); console.log(`snapshot: ${argv.snapshot}`); } catch (e) { console.error("snapshot:", e.message); }
    console.log(`windows: ${BrowserWindow.getAllWindows().map((w) => `${w.id}=${currentOf(w) ?? "connect"}${w.isFocused() ? "*" : ""}`).join(" ")}`);
    console.log(`menu: ${computerItems().map((i) => `${i.label}${i.checked ? "*" : ""}`).join(" | ")}  current=${load().current ?? "-"}`);
    app.quit();
  }, Number(argv["snapshot-delay"] ?? 4000)));
  app.on("activate", () => { if (!BrowserWindow.getAllWindows().length) openWindow(load().current); });
  if (app.isPackaged) updater.autoUpdater.checkForUpdatesAndNotify().catch(() => {});
});
