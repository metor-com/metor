// The bridge between the interface and the phone app (ADR-0015): `window.metor`, the same API the
// desktop app's preload exposes (client/desktop/src/preload.cjs), read by frontend/src/lib/base.js.
// The interface itself is unchanged. Differences to the desktop: there is no main process, so this
// script – part of the app, not of the interface – adds the session token itself: fetch and the SSE
// stream to the connected computer get an Authorization header (patched below), and the session
// also goes into the WebView's cookie jar for that computer, because the screen and terminal frames
// and inline pictures are plain subresource loads that cannot carry a header (see README).
import { Capacitor, CapacitorCookies, registerPlugin } from "@capacitor/core";
import { App } from "@capacitor/app";
import { LocalNotifications } from "@capacitor/local-notifications";
import { SecureStorage } from "@aparajita/capacitor-secure-storage";
import { InAppBrowser, DefaultWebViewOptions } from "@capacitor/inappbrowser";
import { Filesystem, Directory } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import { FileOpener } from "@capacitor-community/file-opener";
// Native push (ADR-0017): registration with APNs/FCM and the device's Web Push key pair, implemented in
// ios/App/App/MetorPushPlugin.swift and android/…/MetorPushPlugin.kt; absent in a browser
const MetorPush = registerPlugin("MetorPush");
const PUSH_RELAY = __METOR_PUSH_RELAY__;   // the relay of this app build (scripts/copy-ui.mjs, default https://push.metor.com)

const VERSION = __METOR_VERSION__;          // filled in by scripts/copy-ui.mjs
const STORE_KEY = "computers";
const COOKIE = "metor_session";            // the gateway's session cookie (metor-auth.mjs)
const platform = Capacitor.getPlatform();  // "ios" | "android" ("web" when the bundle runs in a browser)
const nativeFetch = window.fetch.bind(window);
const NativeEventSource = window.EventSource;

// ---------- Computers: origin, name and the session secret (keychain on iOS, keystore-encrypted on Android) ----------
let db = { computers: [], current: null };
async function load() {
  try { await SecureStorage.setSynchronize(false); } catch (e) { console.warn("metor: setSynchronize", e?.message ?? e); }   // sessions are per device (ADR-0012), never iCloud
  try { const v = await SecureStorage.get(STORE_KEY); console.log("metor: store", v === null ? "empty" : typeof v); if (v && typeof v === "object" && !Array.isArray(v)) db = { computers: [], current: null, ...v }; }
  catch (e) { console.error("metor: store read failed", e?.message ?? e); }
}
// Keychain writes fail with -34018 (errSecMissingEntitlement) in a build made with CODE_SIGNING_ALLOWED=NO –
// simulator builds must keep Xcode's "Sign to Run Locally" signature (see README)
const save = async () => { await SecureStorage.set(STORE_KEY, db); console.log("metor: store saved", db.computers.length, db.current); };
const computer = (id) => db.computers.find((c) => c.id === id) ?? null;
const current = () => computer(db.current);
// What the app has learned about a computer since it started: the unread total (the overview's badge) and whether it answers
const status = new Map();   // id → { unread, reachable }
const publicInfo = (c, extra = {}) => (c ? { id: c.id, name: c.label || c.name, short: c.label || c.name, origin: c.origin, version: c.version ?? null, signedIn: !!c.secret, local: false,
  unread: status.get(c.id)?.unread ?? null, reachable: status.get(c.id)?.reachable ?? null, ...extra } : null);
const nameFor = (origin) => { try { return new URL(origin).hostname; } catch { return origin; } };
const randomId = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => b.toString(16).padStart(2, "0")).join("");
const deviceLabel = () => `metor app on ${{ ios: "iPhone", android: "Android" }[platform] ?? platform}`;
const isOurs = (u, c) => !!c && String(u).startsWith(c.origin + "/");
// Plain http only where the wire is the user's own: this device, the local network, a .local name.
// Anywhere else the claim and then the session secret would cross the internet in the clear
const PRIVATE_HOST = /^(localhost|127\.\d+\.\d+\.\d+|\[::1\]|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|[^.]+\.local)$/i;
const insecureOrigin = (origin) => { try { const u = new URL(origin); return u.protocol === "http:" && !PRIVATE_HOST.test(u.hostname); } catch { return true; } };

async function fetchJson(url, init = {}, ms = 8000) {
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), ms);
  try { const r = await nativeFetch(url, { ...init, signal: ac.signal }); return { ok: r.ok, status: r.status, data: await r.json().catch(() => null) }; }
  finally { clearTimeout(t); }
}
async function reachable(origin) {
  try { const r = await fetchJson(`${origin}/bots/api/version`, {}, 3000); return r.ok && r.data?.name === "metor"; } catch { return false; }
}
// The session as a cookie for that computer's host, meant for what the WebView loads itself
// (frames, inline pictures). Verified 2026-09-06 in the iOS simulator: the cookie is stored, but
// WKWebView does not send it with cross-site subresource loads from the app's origin (third-party
// cookie) – a public icon loads, an avatar behind the sign-in does not. Kept for Android and for
// a future top-level web view; the frames need another way (see README, "Open").
async function setSessionCookie(c) { if (c?.secret) { try { await CapacitorCookies.setCookie({ url: `${c.origin}/bots/`, key: COOKIE, value: c.secret, path: "/" }); } catch (e) { console.warn("metor: cookie", e?.message ?? e); } } }
async function clearSessionCookie(c) { if (c) { try { await CapacitorCookies.deleteCookie({ url: c.origin, key: COOKIE }); } catch {} } }

// The interface again, from the top (no hash: `#/connect/…` must not be taken for a bot)
const reload = () => location.replace("/");

// Connect: a setup link, a pairing link or a pairing code (ADR-0012) becomes a session of this app –
// the same parsing as the desktop app (main.mjs connect())
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
  if (insecureOrigin(origin)) return { ok: false, error: `${origin} is plain http on the internet – the session would travel unencrypted. Use https, or a computer on this device or your local network.` };
  if (!token && !code) return { ok: false, error: "Enter a setup link, a pairing link or a pairing code." };
  let v; try { v = await fetchJson(`${origin}/bots/api/version`); } catch (e) { return { ok: false, error: `No answer from ${origin} (${e.message}).` }; }
  if (!v.ok || v.data?.name !== "metor") return { ok: false, error: `No bots' computer of metor answers at ${origin}.` };
  if (!v.data.capabilities?.redeem) return { ok: false, error: `The bots' computer at ${origin} is too old for the app – update it to 0.2 or newer.` };
  let r; try { r = await fetchJson(`${origin}/bots/api/auth/redeem`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token, code, name: deviceLabel() }) }); }
  catch (e) { return { ok: false, error: e.message }; }
  if (!r.ok || !r.data?.secret) return { ok: false, error: r.data?.error ?? `HTTP ${r.status}` };
  let c = db.computers.find((x) => x.origin === origin);
  if (!c) { c = { id: randomId(), origin, name: nameFor(origin), createdAt: Date.now() }; db.computers.push(c); }
  c.secret = r.data.secret; c.session = r.data.session; c.version = v.data.version;
  db.current = c.id; await save(); await setSessionCookie(c);
  return { ok: true, id: c.id };
}
// Forget a computer: sign the session out there (best effort), then drop it here
async function forget(id) {
  const c = computer(id); if (!c) return;
  if (c.secret && c.pushEndpoint) { try { await fetchJson(`${c.origin}/bots/api/push/unsubscribe`, { method: "POST", headers: { authorization: `Bearer ${c.secret}`, "content-type": "application/json" }, body: JSON.stringify({ endpoint: c.pushEndpoint }) }, 4000); } catch {} }
  if (c.secret) { try { await fetchJson(`${c.origin}/bots/api/auth/logout`, { method: "POST", headers: { authorization: `Bearer ${c.secret}` } }, 4000); } catch {} }
  await clearSessionCookie(c);
  try { await MetorPush.clearComputer({ id }); } catch {}
  db.computers = db.computers.filter((x) => x.id !== id);
  const wasCurrent = db.current === id; if (wasCurrent) db.current = null;
  await save(); if (wasCurrent) reload();
}
// The computer answered 401: the session is gone (revoked there) – keep the entry, drop the secret
async function signedOut(id = db.current) {
  const c = computer(id); if (!c?.secret) return;
  c.secret = null; await clearSessionCookie(c); try { await MetorPush.clearComputer({ id: c.id }); } catch {} await save();
  if (c.id === db.current) reload();
}
// Ask a computer for its bot list: does it answer, how much is unread – the overview of the computers
// (knowledge/design/several-computers.md) probes all of them when it opens. The native side keeps the
// count per computer for the app icon's badge, the sum over all computers.
const unreadOf = (list) => list.reduce((n, a) => n + (Number(a.unread) || 0), 0);
async function probe(c) {
  if (!c?.secret) { status.set(c.id, { unread: null, reachable: await reachable(c.origin) }); return; }
  try {
    const r = await fetchJson(`${c.origin}/bots/api/agents`, { headers: { authorization: `Bearer ${c.secret}` } }, 5000);
    if (r.status === 401) { status.set(c.id, { unread: null, reachable: true }); await signedOut(c.id); return; }
    if (r.ok && Array.isArray(r.data)) {
      status.set(c.id, { unread: unreadOf(r.data), reachable: true });
      if (c.id !== db.current) MetorPush.setBadge({ computer: c.id, count: unreadOf(r.data), read: r.data.filter((a) => !a.unread).map((a) => a.name) }).catch(() => {});
    } else status.set(c.id, { ...(status.get(c.id) ?? { unread: null }), reachable: r.ok });
  } catch { status.set(c.id, { ...(status.get(c.id) ?? { unread: null }), reachable: false }); }
}
async function gateways(opts = null) {
  if (opts?.probe) await Promise.all(db.computers.map(probe));
  return db.computers.map((x) => publicInfo(x));
}

// ---------- The session token on every request to the connected computer (the interface is unchanged) ----------
window.fetch = (input, init = {}) => {
  const c = current(); const u = typeof input === "string" ? input : input?.url ?? String(input);
  if (!c?.secret || !isOurs(u, c)) return nativeFetch(input, init);
  const headers = new Headers(init.headers ?? (input instanceof Request ? input.headers : undefined));
  if (!headers.has("authorization")) headers.set("authorization", `Bearer ${c.secret}`);
  return nativeFetch(input, { ...init, headers });
};
// EventSource cannot carry a header – for the computer's stream a small replacement on top of fetch.
// Reconnecting is the interface's job (events.js closes on error and opens a new one), as with the real thing.
class BearerEventSource extends EventTarget {
  constructor(url, secret) { super(); this.url = url; this.readyState = 0; this.onopen = null; this.onerror = null; this.onmessage = null; this.ac = new AbortController(); this.run(secret); }
  async run(secret) {
    let res;
    try { res = await nativeFetch(this.url, { headers: { authorization: `Bearer ${secret}`, accept: "text/event-stream" }, cache: "no-store", signal: this.ac.signal }); }
    catch { return this.fail(); }
    if (!res.ok || !res.body) return this.fail();
    this.readyState = 1; this.onopen?.(new Event("open"));
    const reader = res.body.getReader(), dec = new TextDecoder();
    let buf = "", event = "message", data = [];
    const flush = () => {
      if (data.length) {
        const text = data.join("\n"), ev = new MessageEvent(event, { data: text }); this.dispatchEvent(ev); if (event === "message") this.onmessage?.(ev);
        if (event === "agents") badgeFromAgents(text);   // the bot list is the source of the app icon's badge
      }
      event = "message"; data = [];
    };
    try {
      for (;;) {
        const { value, done } = await reader.read(); if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, i).replace(/\r$/, ""); buf = buf.slice(i + 1);
          if (line === "") { flush(); continue; }
          if (line.startsWith(":")) continue;
          const j = line.indexOf(":"), field = j < 0 ? line : line.slice(0, j), val = j < 0 ? "" : line.slice(j + 1).replace(/^ /, "");
          if (field === "event") event = val; else if (field === "data") data.push(val);
        }
      }
    } catch {}
    this.fail();
  }
  fail() { if (this.readyState === 2) return; this.readyState = 2; this.onerror?.(new Event("error")); }
  close() { this.readyState = 2; this.ac.abort(); }
}
window.EventSource = function EventSource(url, init) {
  const c = current();
  return c?.secret && isOurs(url, c) ? new BearerEventSource(String(url), c.secret) : new NativeEventSource(url, init);
};

// ---------- The app icon's badge: unread replies across bots, from the bot list the stream delivers ----------
// Pushes carry the same number for the time the app is closed; while it is open, every agents event puts the badge
// right and clears the notifications of bots that were read (native: MetorPush.setBadge). Every event, not only
// changed counts: a notification can arrive for a bot that another device has read meanwhile.
let lastAgents = null;
function badgeFromAgents(text) {
  lastAgents = text;
  let list; try { list = JSON.parse(text); } catch { return; }
  if (!Array.isArray(list)) return;
  const count = unreadOf(list);
  const read = list.filter((a) => !a.unread).map((a) => a.name);
  status.set(db.current, { unread: count, reachable: true });
  MetorPush.setBadge({ computer: db.current, count, read }).catch(() => {});   // this computer's count; the icon shows the sum
}

// ---------- Notifications while the app is open (the gateway's notify events); push comes later, with the relay ----------
// A tap names the bot and, from a push, the computer it came from: another computer than the one shown
// means switching first – the interface loads anew, so the bot to open waits in sessionStorage
const OPEN_KEY = "metor:open";
let openBotCallback = null, pendingBot = sessionStorage.getItem(OPEN_KEY) || null, notifyId = 1;
sessionStorage.removeItem(OPEN_KEY);
const openBot = (bot, computerId = null) => {
  if (!bot) return;
  if (computerId && computerId !== db.current && computer(computerId)?.secret) { sessionStorage.setItem(OPEN_KEY, bot); use(computerId); return; }
  if (openBotCallback) openBotCallback(bot); else pendingBot = bot;
};
let pushEndpoint = null;   // the subscription registered with the current computer, null without native push
let pushState = { state: "off", error: null };   // what the settings card shows: on | off | denied | unavailable
let pushInFlight = null;                          // the registration running at start – the card waits for it
async function notify(n) {
  if (pushEndpoint) return;   // the gateway pushes to this device natively; a local copy would double it
  try {
    let p = (await LocalNotifications.checkPermissions()).display;
    if (p !== "granted") p = (await LocalNotifications.requestPermissions()).display;
    if (p !== "granted") return;
    await LocalNotifications.schedule({ notifications: [{ id: notifyId++, title: n?.title ?? "metor", body: n?.body ?? "", extra: { bot: n?.bot ?? null } }] });
  } catch {}
}
LocalNotifications.addListener("localNotificationActionPerformed", (e) => openBot(e.notification?.extra?.bot));

// ---------- The bot's screen or terminal in a web view of its own ----------
// A frame inside the app's page is a cross-site load and WKWebView withholds the session cookie
// from it. A top-level page on the computer's host is first-party: the cookie travels, the gateway
// serves page, assets, watch cookie and the WebSocket as for a browser – both verified 2026-09-06
// in the iOS simulator (the in-app web view shares the cookie jar with the app's WebView).
// ComputerPanel.svelte calls this for Screen and Terminal when it runs inside the app.
async function openComputer(url) {
  await InAppBrowser.openInWebView({ url, options: {
    ...DefaultWebViewOptions, showURL: false, showToolbar: true, clearCache: false, clearSessionCache: false,
    // Android: the plugin's default is a web view in an isolated process, which has a cookie store of its
    // own – the session cookie never reaches it. In the app's process it shares the jar (verified 2026-09-06).
    android: { ...DefaultWebViewOptions.android, isIsolated: false },
  } });
}

// ---------- Files (attachments, the file browser): downloaded with the session, opened by the system ----------
// A link cannot carry the token and the WebView withholds the cookie from cross-site loads (see README), so
// the interface hands a tapped file here (frontend/src/lib/media.js): downloaded into the app's cache with the
// token (natively, no detour through JavaScript), then Quick Look on iOS / the app registered for the type on
// Android; the share sheet when nothing opens it. The cache folder is emptied at every start.
const FILE_TYPES = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml", heic: "image/heic",
  pdf: "application/pdf", txt: "text/plain", md: "text/plain", csv: "text/csv", json: "application/json", html: "text/html", zip: "application/zip",   // md as plain text: Quick Look knows no markdown
  mp4: "video/mp4", mov: "video/quicktime", mp3: "audio/mpeg", m4a: "audio/mp4", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation" };
const FILES_DIR = "metor-files";
async function openFile(url, name) {
  const c = current();
  if (!c?.secret || !isOurs(url, c)) throw new Error("not a file of the connected computer");
  const safe = String(name || "file").replace(/[^\w.\- ()]+/g, "_").slice(-120) || "file";
  const dir = `${FILES_DIR}/${randomId()}`, path = `${dir}/${safe}`;   // its own folder, so the viewer sees the real name
  const r = await nativeFetch(url, { method: "HEAD", headers: { authorization: `Bearer ${c.secret}` } }).catch(() => null);
  if (r && !r.ok) throw new Error(r.status === 404 ? "the file is no longer there" : `HTTP ${r.status}`);
  await Filesystem.mkdir({ path: dir, directory: Directory.Cache, recursive: true }).catch(() => {});   // downloadFile's `recursive` is not honoured on Android
  await Filesystem.downloadFile({ url, path, directory: Directory.Cache, headers: { authorization: `Bearer ${c.secret}` } });
  const { uri } = await Filesystem.getUri({ path, directory: Directory.Cache });
  const contentType = FILE_TYPES[safe.split(".").pop()?.toLowerCase()] ?? "application/octet-stream";
  try { await FileOpener.open({ filePath: uri, contentType, openWithDefault: true }); }
  catch (e) { console.warn("metor: open file", e?.message ?? e); await Share.share({ title: safe, files: [uri] }); }
}
Filesystem.rmdir({ path: FILES_DIR, directory: Directory.Cache, recursive: true }).catch(() => {});

// ---------- Native push: register with APNs/FCM, then hand the gateway a Web Push subscription whose endpoint is the relay ----------
// The gateway treats it like any browser subscription (metor-push.mjs): it encrypts for the device's key pair and
// posts to the endpoint; the relay forwards to Apple or Google; the app decrypts (notification extension / messaging service).
function registerPush(c) { pushInFlight = doRegisterPush(c).finally(() => { pushInFlight = null; }); return pushInFlight; }
async function doRegisterPush(c) {
  if (!c?.secret || platform === "web") return (pushState = { state: "unavailable", error: null });
  let r; try { r = await MetorPush.register(); } catch (e) { console.warn("metor: push", e?.message ?? e); return (pushState = { state: "unavailable", error: e?.message ?? String(e) }); }
  if (!r?.token || !r.p256dh || !r.auth) {
    console.log("metor: push not available", r?.reason ?? "");
    return (pushState = r?.reason === "denied" ? { state: "denied", error: null } : { state: "unavailable", error: r?.reason ?? "no token" });
  }
  const route = r.platform === "android" ? "fcm" : r.sandbox ? "apns-sandbox" : "apns";
  const endpoint = `${PUSH_RELAY}/v1/${route}/${r.token}?c=${c.id}`;   // ?c: which computer sent a push (the relay passes it on)
  try {
    // A token that changed (reinstall, new FCM token): drop the previous subscription so the computer does not push twice
    if (c.pushEndpoint && c.pushEndpoint !== endpoint) { try { await fetchJson(`${c.origin}/bots/api/push/unsubscribe`, { method: "POST", headers: { authorization: `Bearer ${c.secret}`, "content-type": "application/json" }, body: JSON.stringify({ endpoint: c.pushEndpoint }) }, 6000); } catch {} }
    const res = await fetchJson(`${c.origin}/bots/api/push/subscribe`, { method: "POST", headers: { authorization: `Bearer ${c.secret}`, "content-type": "application/json" }, body: JSON.stringify({ subscription: { endpoint, keys: { p256dh: r.p256dh, auth: r.auth } } }) });
    if (res.ok) {
      pushEndpoint = endpoint; if (c.pushEndpoint !== endpoint) { c.pushEndpoint = endpoint; await save(); }
      // The native side answers approvals from the notification itself (Approve / Deny) – it needs the computer's address and session
      try { await MetorPush.setComputer({ id: c.id, origin: c.origin, token: c.secret }); } catch (e) { console.warn("metor: push computer", e?.message ?? e); }
      console.log("metor: push registered", route);
      if (lastAgents) badgeFromAgents(lastAgents);   // the permission may have just been granted – the badge is allowed now
      return (pushState = { state: "on", error: null });
    }
    console.warn("metor: push subscribe", res.status, res.data?.error ?? "");
    return (pushState = { state: res.status === 404 ? "unavailable" : "off", error: res.data?.error ?? `HTTP ${res.status}` });
  } catch (e) { console.warn("metor: push subscribe", e?.message ?? e); return (pushState = { state: "off", error: e?.message ?? String(e) }); }
}
// The switch in Settings → Devices ("Notifications on this device", the same card the PWA has): off means
// no subscription at the computer and no registration at the next start; the preference is per device
async function disablePush() {
  const c = current();
  if (c?.secret && pushEndpoint) { try { await fetchJson(`${c.origin}/bots/api/push/unsubscribe`, { method: "POST", headers: { authorization: `Bearer ${c.secret}`, "content-type": "application/json" }, body: JSON.stringify({ endpoint: pushEndpoint }) }, 6000); } catch {} }
  if (c) { try { await MetorPush.clearComputer({ id: c.id }); } catch {} c.pushEndpoint = null; }
  pushEndpoint = null; db.pushEnabled = false; await save();
  return (pushState = { state: "off", error: null });
}
async function enablePush() {
  db.pushEnabled = true; await save();
  return registerPush(current());
}
// A tap on a push notification carries the bot (payload of metor-push.mjs) and the computer (`c` on the subscription's
// endpoint); the extension/service put both into the notification
MetorPush.addListener("opened", (e) => openBot(e?.bot, e?.computer || null)).catch(() => {});   // no native plugin in a browser

// ---------- Links: metor://connect?url=…&token=… (also …&code=…) from a pairing link or QR code; metor://open?bot=… ----------
// A connect link is redeemed once: Android hands the launch link to appUrlOpen as well, at the same
// moment (the Set); iOS delivers a cold-start link to appUrlOpen too, and after the reload that follows
// the connect getLaunchUrl still returns it (sessionStorage, verified on an iPhone 2026-09-06 – the
// second redeem showed "invalid or expired" although the first had connected)
const handledLinks = new Set();
async function handleLink(link) {
  let u; try { u = new URL(link); } catch { return false; }
  if (u.protocol !== "metor:") return false;
  if (u.searchParams.get("bot")) { openBot(u.searchParams.get("bot")); return false; }
  if (!u.searchParams.get("token") && !u.searchParams.get("code")) return false;
  if (handledLinks.has(link) || sessionStorage.getItem("metor:launch") === link) return false;
  handledLinks.add(link); sessionStorage.setItem("metor:launch", link);
  const r = await connect({ claim: link });
  console.log("metor: link", r.ok ? "connected" : r.error);
  if (!r.ok) { alert(r.error); return false; }
  return true;   // connected – the caller reloads
}
App.addListener("appUrlOpen", async ({ url }) => {
  try { if (await handleLink(url)) reload(); } catch (e) { alert(`metor: ${e?.message ?? e}`); }
});
// Nothing here may fail silently – on a phone there is no console to look at
window.addEventListener("unhandledrejection", (e) => alert(`metor app: ${e.reason?.message ?? e.reason}`));
window.addEventListener("error", (e) => alert(`metor app: ${e.message}`));

// ---------- Start: the store, the launch link, the current computer, then the interface ----------
await load();
// The launch link stays the launch link for the whole process – handleLink redeems it once (see there)
try {
  const l = await App.getLaunchUrl();
  if (l?.url && await handleLink(l.url)) reload();
} catch (e) { console.warn("metor: launch link", e?.message ?? e); }
const c = current();
if (c?.secret) await setSessionCookie(c);
const reach = c?.secret ? await reachable(c.origin) : undefined;
async function use(id) { if (!computer(id)) return; db.current = id; await save(); await setSessionCookie(computer(id)); reload(); }
window.metor = {
  platform, version: VERSION,
  gateway: publicInfo(c, reach === undefined ? {} : { reachable: reach }),
  gateways,
  connect: async (args) => { const r = await connect(args ?? {}); if (r.ok) reload(); return r; },
  use,
  forget,
  rename: async (id, name) => { const x = computer(id); if (!x) return; const n = String(name ?? "").trim().slice(0, 60); if (n) x.label = n; else delete x.label; await save(); },   // the user's own name, kept here
  signedOut: () => { signedOut(); },
  notify,
  openComputer,
  fetchMedia: true,   // pictures cannot be loaded by the WebView itself – the interface fetches them (frontend/src/lib/media.js)
  openFile,
  push: { state: async () => { if (pushInFlight) await pushInFlight; return pushState; }, enable: enablePush, disable: disablePush },
  onOpenBot: (cb) => { openBotCallback = cb; if (pendingBot) { const b = pendingBot; pendingBot = null; cb(b); } },
};
// Now the interface: base.js reads window.metor when its module is evaluated
const entry = document.querySelector("script[data-entry]")?.dataset.entry;
if (entry) { const s = document.createElement("script"); s.type = "module"; s.src = entry; document.head.appendChild(s); }
if (c?.secret && reach && db.pushEnabled !== false) registerPush(c);   // in the background; the interface does not wait for it
