// metor desktop – the Electron shell around the interface (ADR-0015).
// The renderer is the unchanged interface build (ui/), served from the app's own origin
// app://metor. Every request to a connected computer gets that computer's session token added
// here, in the main process, so the page never holds it. Native parts only: connecting and the
// keychain, tray and menus, notifications, screen capture, the metor:// link, the updater.
import { app, BrowserWindow, Menu, Notification, Tray, desktopCapturer, dialog, ipcMain, nativeImage, net, protocol, safeStorage, session, shell } from "electron";
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
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
const nameFor = (origin) => { try { const h = new URL(origin).hostname; return h === "127.0.0.1" || h === "localhost" ? "This machine" : h; } catch { return origin; } };

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
const currentOf = (win) => windows.get(win) ?? null;
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
  win.loadURL(UI_URL);
  return win;
}
function focusOrOpen(id) { const w = [...windows].find(([, cid]) => cid === id)?.[0]; if (w) show(w); else openWindow(id); }
function switchWindow(win, id) { windows.set(win, id); if (id) { load().current = id; save(); } win.loadURL(UI_URL); }

// ---------- Tray and menus ----------
let tray = null;
function computerItems() { const list = load().computers; return list.length ? list.map((c) => ({ label: c.name, click: () => focusOrOpen(c.id) })) : [{ label: "No computer connected", enabled: false }]; }
function refreshMenus() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform === "darwin" ? [{ role: "appMenu" }] : []),
    { label: "Computer", submenu: [{ label: "Connect a computer…", click: () => openWindow(null) }, { type: "separator" }, ...computerItems()] },
    { role: "editMenu" }, { role: "viewMenu" }, { role: "windowMenu" },
  ]));
  tray?.setContextMenu(Menu.buildFromTemplate([
    { label: "Open metor", click: () => focusOrOpen(load().current ?? load().computers[0]?.id ?? null) },
    { type: "separator" }, ...computerItems(), { label: "Connect a computer…", click: () => openWindow(null) },
    { type: "separator" }, { label: "Quit metor", role: "quit" },
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
app.on("second-instance", (_e, args) => { const link = args.find(isLink); if (link) handleLink(link); else { const w = BrowserWindow.getAllWindows()[0]; if (w) show(w); else openWindow(load().current); } });
app.on("open-url", (e, link) => { e.preventDefault(); if (app.isReady()) handleLink(link); else app.whenReady().then(() => handleLink(link)); });

// ---------- IPC for the preload API (window.metor) ----------
ipcMain.on("metor:info", (e) => { const win = BrowserWindow.fromWebContents(e.sender); e.returnValue = { platform: process.platform, version: app.getVersion(), gateway: publicInfo(computer(currentOf(win))) }; });
ipcMain.handle("metor:gateways", () => load().computers.map(publicInfo));
ipcMain.handle("metor:connect", async (e, args) => { const r = await connect(args ?? {}); if (r.ok) { switchWindow(BrowserWindow.fromWebContents(e.sender), r.id); refreshMenus(); } return r; });
ipcMain.handle("metor:use", (e, id) => { if (computer(id)) switchWindow(BrowserWindow.fromWebContents(e.sender), id); });
ipcMain.handle("metor:forget", async (_e, id) => { await forget(id); for (const [w, cid] of windows) if (cid === id) switchWindow(w, null); refreshMenus(); });
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
  if (argv.open) win.loadURL(`${UI_URL}#/${argv.open}`);   // start with that bot's chat open
  // Development aid: --snapshot=<file.png> captures the window after loading and quits
  if (argv.snapshot) win.webContents.once("did-finish-load", () => setTimeout(async () => {
    try { writeFileSync(String(argv.snapshot), (await win.webContents.capturePage()).toPNG()); console.log(`snapshot: ${argv.snapshot}`); } catch (e) { console.error("snapshot:", e.message); }
    app.quit();
  }, Number(argv["snapshot-delay"] ?? 4000)));
  app.on("activate", () => { if (!BrowserWindow.getAllWindows().length) openWindow(load().current); });
  if (app.isPackaged) updater.autoUpdater.checkForUpdatesAndNotify().catch(() => {});
});
