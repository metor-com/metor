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
const encrypt = (s) => (safeStorage.isEncryptionAvailable() ? `enc:${safeStorage.encryptString(s).toString("base64")}` : `raw:${s}`);
const decrypt = (v) => { try { return v?.startsWith("enc:") ? safeStorage.decryptString(Buffer.from(v.slice(4), "base64")) : v?.startsWith("raw:") ? v.slice(4) : null; } catch { return null; } };
const secrets = new Map();   // id → session secret, decrypted once
function secretOf(id) { if (!id) return null; if (!secrets.has(id)) { const c = load().computers.find((x) => x.id === id); secrets.set(id, c?.secret ? decrypt(c.secret) : null); } return secrets.get(id); }
const computer = (id) => load().computers.find((c) => c.id === id) ?? null;
const publicInfo = (c) => (c ? { id: c.id, name: c.name, origin: c.origin, version: c.version ?? null, signedIn: !!secretOf(c.id) } : null);
// Which computer a request goes to – WebSocket URLs (ws:, wss:) belong to the http(s) origin they came from
function computerForUrl(u) {
  try { const x = new URL(u), secure = x.protocol === "https:" || x.protocol === "wss:"; return load().computers.find((c) => { const o = new URL(c.origin); return o.host === x.host && (o.protocol === "https:") === secure; }) ?? null; }
  catch { return null; }
}
const deviceLabel = () => `metor app on ${{ darwin: "Mac", win32: "Windows", linux: "Linux" }[process.platform] ?? process.platform}`;
const nameFor = (origin) => { try { const u = new URL(origin); return u.hostname === "127.0.0.1" || u.hostname === "localhost" ? `This machine${u.port && u.port !== "6010" ? ` (:${u.port})` : ""}` : u.hostname; } catch { return origin; } };

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
  if (!origin) return { ok: false, error: "Enter the address of the computer." };
  if (!token && !code) return { ok: false, error: "Enter a setup link, a pairing link or a pairing code." };
  let v; try { v = await fetchJson(`${origin}/bots/api/version`); } catch (e) { return { ok: false, error: `No answer from ${origin} (${e.message}).` }; }
  if (!v.ok || v.data?.name !== "metor") return { ok: false, error: `No metor computer answers at ${origin}.` };
  if (!v.data.capabilities?.redeem) return { ok: false, error: `The computer at ${origin} is too old for the app – update it to 0.2 or newer.` };
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
  const d = load(); d.computers = d.computers.filter((x) => x.id !== id); if (d.current === id) d.current = d.computers[0]?.id ?? null; secrets.delete(id); save();
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
async function loadInterface(win, id) {
  const c = computer(id);
  unreachable.delete(win);
  if (c && !(await reachable(c.origin))) unreachable.set(win, c.id);
  if (!win.isDestroyed()) win.loadURL(UI_URL);
}
function show(win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); }
function openWindow(id = null) {
  const win = new BrowserWindow({
    width: 1280, height: 820, minWidth: 720, minHeight: 480, title: "metor", show: false, backgroundColor: "#f4f4f5",
    webPreferences: { preload: PRELOAD, sandbox: true, contextIsolation: true, nodeIntegration: false, spellcheck: true },
  });
  windows.set(win, id);
  win.once("ready-to-show", () => win.show());
  win.on("closed", () => windows.delete(win));
  // Links open in the system browser; the window itself only ever shows the interface
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: "deny" }; });
  win.webContents.on("will-navigate", (e, url) => { if (!url.startsWith(UI_URL)) { e.preventDefault(); if (/^https?:/.test(url)) shell.openExternal(url); } });
  loadInterface(win, id);
  return win;
}
function focusOrOpen(id) { const w = [...windows].find(([, cid]) => cid === id)?.[0]; if (w) show(w); else openWindow(id); }
function switchWindow(win, id) { windows.set(win, id); if (id) { load().current = id; save(); } loadInterface(win, id); }

// ---------- A local computer through the host command (metor setup / box up / box down) ----------
// The `metor` wrapper drives Docker or Apple's `container`; the app only calls it. A packaged app
// carries its own copy (resources/metor), development uses the checkout; a Homebrew one is a fallback.
// Apps started from the Finder carry a minimal PATH, so Homebrew's is added for the runtime CLIs.
const BUNDLED_WRAPPER = app.isPackaged ? join(process.resourcesPath, "metor") : resolve(here, "..", "..", "..", "backend", "harness", "bin", "metor");
const WRAPPER_CANDIDATES = [process.env.METOR_CLI, BUNDLED_WRAPPER, "/opt/homebrew/bin/metor", "/usr/local/bin/metor", join(app.getPath("home"), ".local", "bin", "metor")].filter(Boolean);
const wrapper = () => WRAPPER_CANDIDATES.find((p) => existsSync(p)) ?? null;
const isLocal = (origin) => /^https?:\/\/(127\.0\.0\.1|localhost)(:|$)/.test(origin);
const localComputer = () => load().computers.find((c) => isLocal(c.origin)) ?? null;
const LINK_RE = /https?:\/\/\S+\/bots\/auth\/claim\?token=[\w-]+/;
const broadcast = (channel, data) => { for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(channel, data); };
function wrapperEnv() {
  const env = { ...process.env, PATH: `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH ?? "/usr/bin:/bin"}` };
  const c = localComputer(); let port = null; try { port = c && new URL(c.origin).port; } catch {}
  if (port && !env.METOR_PORT) env.METOR_PORT = port;   // the port the local computer was set up with
  return env;
}
// Runs the host command; unless quiet, every output line goes to the windows (the connect screen shows them)
function runWrapper(args, { quiet = false, ms = 20 * 60_000 } = {}) {
  return new Promise((done) => {
    const w = wrapper(); if (!w) return done({ ok: false, out: "The metor command is missing." });
    let out = "";
    const child = spawn(w, args, { env: wrapperEnv(), stdio: ["ignore", "pipe", "pipe"] });
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
async function localAction(action, win = null) {
  const args = { setup: ["setup", "--no-open"], up: ["box", "up"], down: ["box", "down"] }[action];
  if (!args) return { ok: false, error: `unknown action ${action}` };
  if (localBusy) return { ok: false, error: "The local computer is busy – wait for the running step to finish." };
  localBusy = true; broadcast("metor:local-progress", { start: action, line: `metor ${args.join(" ")}` });
  const r = await runWrapper(args);
  localBusy = false;
  const tail = r.out.split("\n").filter(Boolean).slice(-6).join("\n");
  const finish = (ok, error = null) => { broadcast("metor:local-progress", { done: action, ok, error }); refreshMenus(); return ok ? { ok, tail } : { ok, error }; };
  if (!r.ok) return finish(false, tail || `metor ${args.join(" ")} failed`);
  if (action === "setup") {
    const link = LINK_RE.exec(r.out)?.[0]; if (!link) return finish(false, "The setup printed no link.");
    const c = await connect({ claim: link }); if (!c.ok) return finish(false, c.error);
    const target = win ?? BrowserWindow.getAllWindows()[0] ?? openWindow(null); switchWindow(target, c.id); show(target);
  } else if (action === "up") {
    const c = localComputer();   // windows on the connect screen, or waiting for this computer, show it once it answers
    if (c && secretOf(c.id)) {
      broadcast("metor:local-progress", { line: "waiting for the interface…" });
      if (!(await waitReachable(c.origin))) return finish(false, `The computer started, but its interface at ${c.origin} does not answer – see: metor box logs`);
      for (const [w, cid] of windows) if (cid === null || (cid === c.id && unreachable.get(w) === c.id)) switchWindow(w, c.id);
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
  else if (action !== "setup") new Notification({ title: "metor", body: r.tail.split("\n").pop() || `Local computer: ${action}` }).show();
}
// The local computer comes back with the app (Apple's runtime has no restart policy) unless switched off in the menu
async function autostartLocal() {
  if (load().autostartLocal === false || !localComputer() || !wrapper()) return;
  const st = await localStatus(); if (st.state !== "stopped") return;
  const r = await localAction("up"); if (!r.ok) console.error(`autostart: ${r.error}`);
}
const localItems = () => (wrapper() ? [{ label: "Local computer", submenu: [
  { label: "Set up…", click: () => menuLocal("setup") },
  { label: "Start", click: () => menuLocal("up") },
  { label: "Stop", click: () => menuLocal("down") },
  { type: "separator" },
  { label: "Start automatically when the app opens", type: "checkbox", checked: load().autostartLocal !== false, click: (item) => { load().autostartLocal = item.checked; save(); } },
] }, { type: "separator" }] : []);

// ---------- Tray and menus ----------
let tray = null;
function computerItems() { const list = load().computers; return list.length ? list.map((c) => ({ label: c.name, click: () => focusOrOpen(c.id) })) : [{ label: "No computer connected", enabled: false }]; }
function refreshMenus() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform === "darwin" ? [{ role: "appMenu" }] : []),
    { label: "Computer", submenu: [{ label: "Connect a computer…", click: () => openWindow(null) }, { type: "separator" }, ...localItems(), ...computerItems()] },
    { role: "editMenu" }, { role: "viewMenu" }, { role: "windowMenu" },
  ]));
  tray?.setContextMenu(Menu.buildFromTemplate([
    { label: "Open metor", click: () => focusOrOpen(load().current ?? load().computers[0]?.id ?? null) },
    { type: "separator" }, ...computerItems(), { label: "Connect a computer…", click: () => openWindow(null) },
    { type: "separator" }, ...localItems(), { label: "Quit metor", role: "quit" },
  ]));
}

// ---------- Links: metor://connect?url=…&token=… or a pasted setup/pairing link ----------
async function handleLink(link) {
  const r = await connect({ claim: link });
  const win = BrowserWindow.getAllWindows()[0] ?? openWindow(null);
  if (r.ok) switchWindow(win, r.id); else dialog.showErrorBox("metor", r.error);
  show(win); refreshMenus();
}
const isLink = (a) => /^(metor:|https?:)/.test(a);
if (!app.requestSingleInstanceLock()) app.quit();
// A second launch hands its link to the running app: a metor:// or https link, or `--connect=<link>`
app.on("second-instance", (_e, args) => { const link = args.find(isLink) ?? args.find((a) => a.startsWith("--connect="))?.slice("--connect=".length); if (link) handleLink(link); else { const w = BrowserWindow.getAllWindows()[0]; if (w) show(w); else openWindow(load().current); } });
app.on("open-url", (e, link) => { e.preventDefault(); if (app.isReady()) handleLink(link); else app.whenReady().then(() => handleLink(link)); });

// ---------- IPC for the preload API (window.metor) ----------
ipcMain.on("metor:info", (e) => {
  const win = BrowserWindow.fromWebContents(e.sender); const c = computer(currentOf(win)); const info = publicInfo(c);
  if (info && unreachable.get(win) === c.id) info.reachable = false;   // the connect screen says so and offers Try again / Start
  e.returnValue = { platform: process.platform, version: app.getVersion(), gateway: info };
});
ipcMain.handle("metor:gateways", () => load().computers.map(publicInfo));
ipcMain.handle("metor:connect", async (e, args) => { const r = await connect(args ?? {}); if (r.ok) { switchWindow(BrowserWindow.fromWebContents(e.sender), r.id); refreshMenus(); } return r; });
ipcMain.handle("metor:use", (e, id) => { if (computer(id)) switchWindow(BrowserWindow.fromWebContents(e.sender), id); });
ipcMain.handle("metor:forget", async (_e, id) => { await forget(id); for (const [w, cid] of windows) if (cid === id) switchWindow(w, null); refreshMenus(); });
ipcMain.handle("metor:local-status", () => localStatus());
ipcMain.handle("metor:local", (e, action) => localAction(String(action), BrowserWindow.fromWebContents(e.sender)));
ipcMain.on("metor:signed-out", (e) => {
  const win = BrowserWindow.fromWebContents(e.sender); const c = computer(currentOf(win));
  if (c?.secret) { delete c.secret; secrets.set(c.id, null); save(); }
  win.loadURL(UI_URL); refreshMenus();
});
ipcMain.on("metor:notify", (e, n = {}) => {
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
  ses.setPermissionRequestHandler((_wc, permission, cb) => cb(["media", "notifications", "clipboard-read", "clipboard-sanitized-write", "display-capture", "fullscreen"].includes(permission)));
  // Screen sharing for the bots: the system picker where there is one (macOS 15+), else the primary screen
  ses.setDisplayMediaRequestHandler(async (_req, cb) => {
    try { const sources = await desktopCapturer.getSources({ types: ["screen"] }); cb(sources.length ? { video: sources[0] } : {}); } catch { cb({}); }
  }, { useSystemPicker: true });

  if (app.isPackaged) { try { app.setAsDefaultProtocolClient("metor"); } catch {} }
  try { tray = new Tray(nativeImage.createFromPath(join(here, "assets", "tray.png"))); tray.setToolTip("metor"); tray.on("click", () => focusOrOpen(load().current)); } catch (e) { console.error("tray:", e.message); }
  refreshMenus();

  let id = load().current ?? load().computers[0]?.id ?? null;
  if (argv.connect) { const r = await connect({ claim: String(argv.connect) }); if (r.ok) id = r.id; else console.error(`connect: ${r.error}`); refreshMenus(); }
  const win = openWindow(id);
  if (argv.local) { const r = await localAction(String(argv.local), win); console.log(`local ${argv.local}: ${r.ok ? "ok" : `failed – ${r.error}`}`); }
  else autostartLocal().catch((e) => console.error("autostart:", e.message));
  if (argv.open) win.loadURL(`${UI_URL}#/${argv.open}`);   // start with that bot's chat open
  // Development aid: --snapshot=<file.png> captures the window after loading and quits
  if (argv.snapshot) win.webContents.once("did-finish-load", () => setTimeout(async () => {
    try { writeFileSync(String(argv.snapshot), (await win.webContents.capturePage()).toPNG()); console.log(`snapshot: ${argv.snapshot}`); } catch (e) { console.error("snapshot:", e.message); }
    app.quit();
  }, Number(argv["snapshot-delay"] ?? 4000)));
  app.on("activate", () => { if (!BrowserWindow.getAllWindows().length) openWindow(load().current); });
  if (app.isPackaged) updater.autoUpdater.checkForUpdatesAndNotify().catch(() => {});
});
