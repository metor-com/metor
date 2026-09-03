// Push notifications (ADR-0013): register the service worker, subscribe this browser at the
// gateway and keep the subscription in sync on every start. The state drives the card in the
// Devices dialog:
//   unsupported   – no service worker / push API in this browser
//   unavailable   – the box has no push (image without web-push)
//   needs-install – iPhone/iPad: push works only from the Home Screen app
//   denied        – notifications blocked in the browser or system settings
//   off | on      – not subscribed / subscribed
import { writable, get } from "svelte/store";
import { pushKey, pushSubscribe, pushUnsubscribe, pushTest } from "./api.js";

export const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
export const standalone = () => window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
const supported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

export const pushState = writable({ state: supported() ? "off" : "unsupported", devices: 0, error: null });
// Android/desktop Chrome: the browser offers the install once – we keep the event for an "Install app" button
export const installPrompt = writable(null);
window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); installPrompt.set(e); });
export async function installApp() { const e = get(installPrompt); if (!e) return; try { await e.prompt(); } catch {} installPrompt.set(null); }

let reg = null, serverKey = null;
const b64ToBytes = (s) => { const b = atob(s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=")); return Uint8Array.from(b, (c) => c.charCodeAt(0)); };
const bytesToB64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const set = (state, patch = {}) => pushState.update((s) => ({ ...s, error: null, ...patch, state }));

export async function initPush() {
  if (!supported()) return;
  try { reg = await navigator.serviceWorker.register("/bots/sw.js", { scope: "/bots/" }); }
  catch (e) { set("unsupported", { error: e.message }); return; }
  // A tap on a notification: the worker asks the open window to show that bot
  navigator.serviceWorker.addEventListener("message", (e) => {
    if (e.data?.type === "open" && e.data.url) { try { location.hash = new URL(e.data.url, location.href).hash; } catch {} }
  });
  await syncState();
}

async function syncState() {
  let info;
  try { info = await pushKey(); } catch (e) { set("unavailable", { error: e.message }); return; }
  if (!info.enabled) { set("unavailable"); return; }
  serverKey = info.publicKey;
  if (isIOS && !standalone()) { set("needs-install", { devices: info.subscribed }); return; }
  if (Notification.permission === "denied") { set("denied", { devices: info.subscribed }); return; }
  const sub = await reg.pushManager.getSubscription();
  if (sub && Notification.permission === "granted") {
    // Subscribed with the gateway's current key? Otherwise (push.json recreated) start over
    const key = sub.options?.applicationServerKey ? bytesToB64(sub.options.applicationServerKey) : serverKey;
    if (key !== serverKey) { await sub.unsubscribe().catch(() => {}); set("off", { devices: info.subscribed }); return; }
    try { const r = await pushSubscribe(sub.toJSON()); set("on", { devices: r.subscribed ?? info.subscribed }); }
    catch (e) { set("on", { devices: info.subscribed, error: e.message }); }
    return;
  }
  set("off", { devices: info.subscribed });
}

// Runs inside the tap on the button – Safari and iOS grant permission only from a user gesture
export async function enablePush() {
  if (!reg || !serverKey) { pushState.update((s) => ({ ...s, error: "push is not ready yet – try again in a moment" })); return; }
  try {
    const perm = await Notification.requestPermission();
    if (perm !== "granted") { set(perm === "denied" ? "denied" : "off"); return; }
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(serverKey) });
    const r = await pushSubscribe(sub.toJSON());
    set("on", { devices: r.subscribed ?? 1 });
  } catch (e) { pushState.update((s) => ({ ...s, error: e.message })); }
}
export async function disablePush() {
  try {
    const sub = await reg?.pushManager.getSubscription();
    if (sub) { await pushUnsubscribe(sub.endpoint).catch(() => {}); await sub.unsubscribe(); }
    set("off", { devices: 0 });
  } catch (e) { pushState.update((s) => ({ ...s, error: e.message })); }
}
export const testPush = () => pushTest();
