// metor-push – Web Push without a relay (ADR-0013). Every signed-in device may subscribe its
// browser's push endpoint here; the gateway signs each message with its own VAPID key pair and
// sends it straight to the device's push service (Apple, Google, Mozilla) – the payload is
// encrypted for the device, no metor server in between. State: /workspace/.metor/push.json
// (the VAPID keys plus every subscription, bound to the session that created it). Needs the
// `web-push` package in the image; without it push is simply reported as unavailable.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

const STORE_DIR = process.env.METOR_AUTH_DIR ?? join(process.env.METOR_WORKSPACE_DIR ?? "/workspace", ".metor");
const FILE = join(STORE_DIR, "push.json");
// VAPID "subject": whom the push services may contact about this sender (URL or mailto:)
const SUBJECT = process.env.METOR_PUSH_SUBJECT || "https://github.com/metor-com/metor";
const MAX_PER_SESSION = 5;          // one browser profile = one subscription; a few spares for re-installs
const TTL = 24 * 60 * 60;           // seconds a push service keeps an undelivered message
const MAX_FAILURES = 20;            // consecutive delivery errors before an endpoint is dropped

let lib = null, libError = null;
async function webPush() {
  if (lib || libError) return lib;
  try { lib = (await import("web-push")).default; }
  catch (e) { libError = e; console.error(`push: web-push unavailable (${e.message}) – notifications off`); }
  return lib;
}

// The gateway is the only writer of push.json, so the file is read once and kept in memory
let db = null;
function load() {
  if (!db) { try { db = { subscriptions: [], ...JSON.parse(readFileSync(FILE, "utf8")) }; } catch { db = { subscriptions: [] }; } }
  return db;
}
function save() {
  mkdirSync(STORE_DIR, { recursive: true });
  const tmp = `${FILE}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(db, null, 2) + "\n", { mode: 0o600 });
  renameSync(tmp, FILE);
}

// Is push possible in this image at all? (no key pair is created by asking)
export const available = async () => !!(await webPush());
// The public half of the VAPID pair – created on first use; null when push is unavailable
export async function publicKey() {
  const wp = await webPush(); if (!wp) return null;
  const d = load();
  if (!d.vapid?.publicKey || !d.vapid?.privateKey) { d.vapid = wp.generateVAPIDKeys(); save(); console.log("push: new VAPID key pair"); }
  return d.vapid.publicKey;
}
export const hasSubscriptions = () => load().subscriptions.length > 0;
export const countForSession = (sessionId) => load().subscriptions.filter((s) => s.sessionId === sessionId).length;

const validSub = (s) => typeof s?.endpoint === "string" && /^https:\/\/\S+$/.test(s.endpoint) && s.endpoint.length < 2048
  && typeof s.keys?.p256dh === "string" && s.keys.p256dh.length < 200 && typeof s.keys?.auth === "string" && s.keys.auth.length < 100;

// Register (or refresh) the subscription of a device; the endpoint is the identity
export function subscribe(sessionId, sub, userAgent) {
  if (!validSub(sub)) return { error: "invalid subscription" };
  const d = load();
  const keys = { p256dh: sub.keys.p256dh, auth: sub.keys.auth };
  const existing = d.subscriptions.find((s) => s.endpoint === sub.endpoint);
  if (existing) Object.assign(existing, { sessionId, keys, seenAt: Date.now(), failures: 0 });
  else {
    const mine = d.subscriptions.filter((s) => s.sessionId === sessionId).sort((a, b) => a.createdAt - b.createdAt);
    while (mine.length >= MAX_PER_SESSION) { const old = mine.shift(); d.subscriptions = d.subscriptions.filter((s) => s !== old); }
    d.subscriptions.push({ id: randomBytes(6).toString("hex"), sessionId, endpoint: sub.endpoint, keys,
      userAgent: String(userAgent ?? "").slice(0, 200), createdAt: Date.now(), seenAt: Date.now(), failures: 0 });
  }
  save();
  return { ok: true, subscribed: countForSession(sessionId) };
}
export function unsubscribe(endpoint) {
  const d = load(); const n = d.subscriptions.length;
  d.subscriptions = d.subscriptions.filter((s) => s.endpoint !== endpoint);
  if (d.subscriptions.length !== n) save();
  return { ok: true };
}
// A signed-out device must not receive anything any more
export function dropSession(sessionId) {
  const d = load(); const n = d.subscriptions.length;
  d.subscriptions = d.subscriptions.filter((s) => s.sessionId !== sessionId);
  if (d.subscriptions.length !== n) save();
}

// One notification to every device – except the sessions in `skip` (they are looking at that
// chat right now), restricted to `only` when given (the test button), and never to a session that
// no longer exists (`sessions` = the live ones; null = no check). Endpoints the push service
// rejects for good (404/410 gone, 401/403 key mismatch) are dropped on the spot.
export async function notify({ kind, bot = null, title, body = "", url = "/bots/", tag = null }, { skip = new Set(), only = null, sessions = null } = {}) {
  const wp = await webPush(); if (!wp) return { enabled: false, sent: 0, failed: 0, removed: 0 };
  const key = await publicKey(); const d = load();
  if (sessions) {
    const n = d.subscriptions.length;
    d.subscriptions = d.subscriptions.filter((s) => sessions.has(s.sessionId));
    if (d.subscriptions.length !== n) save();
  }
  const targets = d.subscriptions.filter((s) => (only ? only.has(s.sessionId) : !skip.has(s.sessionId)));
  if (!targets.length) return { enabled: true, sent: 0, failed: 0, removed: 0 };
  const payload = JSON.stringify({ kind, bot, title: String(title ?? "metor").slice(0, 120), body: String(body ?? "").slice(0, 400),
    url, tag: tag ?? (bot ? `bot:${bot}` : kind), ts: Date.now() });
  const opts = { TTL, urgency: kind === "approval" ? "high" : "normal", vapidDetails: { subject: SUBJECT, publicKey: key, privateKey: d.vapid.privateKey } };
  let sent = 0, failed = 0, removed = 0;
  await Promise.all(targets.map(async (s) => {
    try { await wp.sendNotification({ endpoint: s.endpoint, keys: s.keys }, payload, opts); sent += 1; s.failures = 0; }
    catch (e) {
      const code = e?.statusCode ?? 0;
      s.failures = (s.failures ?? 0) + 1;
      if ([401, 403, 404, 410].includes(code) || s.failures >= MAX_FAILURES) { removed += 1; d.subscriptions = d.subscriptions.filter((x) => x !== s); }
      else failed += 1;
      console.error(`push: ${kind} to ${s.id} (${s.userAgent?.slice(0, 40) ?? "?"}) failed: ${code || e?.message}`);
    }
  }));
  if (removed) save();
  return { enabled: true, sent, failed, removed };
}
