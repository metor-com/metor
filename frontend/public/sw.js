// metor service worker: push notifications and notification taps. No offline shell – the
// interface is live by nature; only the hashed build assets are cached so a launch from the
// home screen is quick. Served by the gateway without a session (it contains nothing secret).
const ASSET_CACHE = "metor-assets-v1";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k !== ASSET_CACHE) await caches.delete(k);
  await self.clients.claim();
})()));

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== self.location.origin || !url.pathname.startsWith("/bots/assets/")) return;
  e.respondWith((async () => {
    const cache = await caches.open(ASSET_CACHE);
    const hit = await cache.match(e.request);
    if (hit) return hit;
    const res = await fetch(e.request);
    if (res.ok) cache.put(e.request, res.clone());
    return res;
  })());
});

// Every push shows a notification – iOS revokes the subscription of a worker that stays silent
self.addEventListener("push", (e) => {
  let data = {};
  try { data = e.data?.json() ?? {}; } catch { data = { title: "metor", body: e.data?.text() ?? "" }; }
  const opts = {
    body: data.body || "",
    tag: data.tag || "metor",
    renotify: true,
    icon: "/bots/icons/icon-192.png",
    badge: "/bots/icons/badge-96.png",
    timestamp: data.ts || Date.now(),
    data: { url: data.url || "/bots/", bot: data.bot ?? null, kind: data.kind ?? null },
  };
  e.waitUntil(self.registration.showNotification(data.title || "metor", opts));
});

// Tap: reuse an open interface window (jump to the bot without a reload), otherwise open one
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || "/bots/", self.location.origin).href;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const app = wins.find((c) => new URL(c.url).pathname === "/bots/");
    if (app) {
      try { await app.focus(); } catch {}
      app.postMessage({ type: "open", url });
      return;
    }
    const other = wins.find((c) => new URL(c.url).pathname.startsWith("/bots"));
    if (other && "navigate" in other) { try { await other.focus(); await other.navigate(url); return; } catch {} }
    await self.clients.openWindow(url);
  })());
});

// The push service rotated the subscription: subscribe again with the same key, tell the gateway
self.addEventListener("pushsubscriptionchange", (e) => {
  e.waitUntil((async () => {
    let key = e.oldSubscription?.options?.applicationServerKey ?? null;
    if (!key) key = (await (await fetch("/bots/api/push/key")).json()).publicKey;
    const sub = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    await fetch("/bots/api/push/subscribe", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ subscription: sub.toJSON() }) });
  })().catch(() => {}));
});
