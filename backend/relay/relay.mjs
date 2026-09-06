// metor push relay (ADR-0017). The gateway sends Web Push (RFC 8030, body encrypted for the device
// per RFC 8291, signed with VAPID per RFC 8292) to whatever endpoint a subscription names. Browsers
// name their vendor's push service; the phone app names this relay, because APNs and FCM accept only
// messages signed with the app publisher's keys. The relay checks the VAPID signature, applies
// limits, wraps the still-encrypted body for Apple or Google and forwards it. It keeps no queue and
// no store, logs no content, and answers with Web Push status codes – 410 when a device token is
// gone, so the gateway drops the subscription as it does for any push service.
//
// Routes:  POST /v1/apns/<token>   POST /v1/apns-sandbox/<token>   POST /v1/fcm/<token>   GET /health
// Config (environment): PORT, HOST, RELAY_ORIGIN (the VAPID audience, e.g. https://push.metor.com),
//   APNS_KEY_FILE (.p8), APNS_KEY_ID, APNS_TEAM_ID, APNS_TOPIC (bundle id), FCM_SERVICE_ACCOUNT_FILE,
//   RELAY_DAILY_LIMIT (per device and UTC day), RELAY_BURST_LIMIT (per device and minute),
//   RELAY_IP_LIMIT (per address and minute); APNS_URL / APNS_SANDBOX_URL / FCM_URL for tests.
import http from "node:http";
import http2 from "node:http2";
import { createHash, createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const MAX_BODY = 4096;      // Web Push's own limit (RFC 8030 §7.2)
const MAX_PAYLOAD = 4096;   // what APNs and FCM accept per message
const b64url = {
  encode: (b) => Buffer.from(b).toString("base64url"),
  decode: (s) => Buffer.from(String(s), "base64url"),
};
const json = (res, code, obj, extra = {}) => { res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store", ...extra }); res.end(JSON.stringify(obj)); };
const tokenTag = (t) => createHash("sha256").update(t).digest("hex").slice(0, 8);   // for the log line, never the token itself

export function configFromEnv(env = process.env) {
  const cfg = {
    port: Number(env.PORT ?? 6020), host: env.HOST ?? "0.0.0.0",
    origin: (env.RELAY_ORIGIN ?? "").replace(/\/$/, ""),
    dailyLimit: Number(env.RELAY_DAILY_LIMIT ?? 500), burstLimit: Number(env.RELAY_BURST_LIMIT ?? 60), ipLimit: Number(env.RELAY_IP_LIMIT ?? 600),
    apns: null, fcm: null,
  };
  if (env.APNS_KEY_FILE) {
    cfg.apns = { key: readFileSync(env.APNS_KEY_FILE, "utf8"), keyId: env.APNS_KEY_ID ?? "", teamId: env.APNS_TEAM_ID ?? "", topic: env.APNS_TOPIC ?? "com.metor.mobile",
      url: env.APNS_URL ?? "https://api.push.apple.com", sandboxUrl: env.APNS_SANDBOX_URL ?? "https://api.sandbox.push.apple.com" };
    if (!cfg.apns.keyId || !cfg.apns.teamId) throw new Error("APNS_KEY_ID and APNS_TEAM_ID are required with APNS_KEY_FILE");
  }
  if (env.FCM_SERVICE_ACCOUNT_FILE) cfg.fcm = { serviceAccount: JSON.parse(readFileSync(env.FCM_SERVICE_ACCOUNT_FILE, "utf8")), url: env.FCM_URL ?? "https://fcm.googleapis.com" };
  return cfg;
}

// ---------- VAPID (RFC 8292): the sender proves it holds the key pair the subscription was made with ----------
export function parseVapid(headers) {
  const auth = String(headers.authorization ?? "");
  let m = /^vapid\s+(.+)$/i.exec(auth);
  if (m) {
    const parts = {};
    for (const p of m[1].split(",")) { const i = p.indexOf("="); if (i > 0) parts[p.slice(0, i).trim()] = p.slice(i + 1).trim(); }
    return parts.t && parts.k ? { t: parts.t, k: parts.k } : null;
  }
  m = /^WebPush\s+(\S+)$/i.exec(auth);   // the older form: token in Authorization, key in Crypto-Key
  if (m) { const k = /p256ecdsa=([A-Za-z0-9_-]+)/.exec(String(headers["crypto-key"] ?? ""))?.[1]; return k ? { t: m[1], k } : null; }
  return null;
}
export function verifyVapid({ t, k }, origin, now = Date.now()) {
  try {
    const [h, p, s] = t.split("."); if (!h || !p || !s) return null;
    const header = JSON.parse(b64url.decode(h).toString()); if (header.alg !== "ES256") return null;
    const claims = JSON.parse(b64url.decode(p).toString());
    if (typeof claims.exp !== "number" || claims.exp * 1000 < now || claims.exp * 1000 > now + 24 * 3600_000 + 60_000) return null;   // at most 24 h ahead
    if (origin && claims.aud !== origin) return null;
    const raw = b64url.decode(k); if (raw.length !== 65 || raw[0] !== 4) return null;
    const key = createPublicKey({ key: { kty: "EC", crv: "P-256", x: b64url.encode(raw.subarray(1, 33)), y: b64url.encode(raw.subarray(33, 65)) }, format: "jwk" });
    return verify("sha256", Buffer.from(`${h}.${p}`), { key, dsaEncoding: "ieee-p1363" }, b64url.decode(s)) ? { key: k, sub: claims.sub ?? null } : null;
  } catch { return null; }
}

// ---------- Limits: per device (day and minute) and per source address (minute), in memory ----------
function limiter({ dailyLimit, burstLimit, ipLimit }) {
  const devices = new Map(), addresses = new Map();
  const day = (t) => Math.floor(t / 86_400_000), minute = (t) => Math.floor(t / 60_000);
  setInterval(() => { const m = minute(Date.now()), d = day(Date.now()); for (const [k, v] of devices) if (v.day < d - 1) devices.delete(k); for (const [k, v] of addresses) if (v.minute < m - 1) addresses.delete(k); }, 600_000).unref();
  return {
    take(token, ip, now = Date.now()) {
      const d = day(now), m = minute(now);
      let a = addresses.get(ip); if (!a || a.minute !== m) { a = { minute: m, count: 0 }; addresses.set(ip, a); }
      if (a.count >= ipLimit) return { ok: false, retry: 60 };
      let v = devices.get(token); if (!v) { v = { day: d, count: 0, minute: m, burst: 0 }; devices.set(token, v); }
      if (v.day !== d) { v.day = d; v.count = 0; }
      if (v.minute !== m) { v.minute = m; v.burst = 0; }
      if (v.count >= dailyLimit) return { ok: false, retry: 86_400 - Math.floor((now % 86_400_000) / 1000) };
      if (v.burst >= burstLimit) return { ok: false, retry: 60 };
      a.count += 1; v.count += 1; v.burst += 1;
      return { ok: true };
    },
  };
}

// ---------- APNs: HTTP/2, a provider token (ES256 JWT) renewed every 50 minutes ----------
function apnsClient(apns) {
  const key = createPrivateKey(apns.key);
  let token = null;
  const sessions = new Map();
  const jwt = (fresh = false) => {
    const now = Math.floor(Date.now() / 1000);
    if (!fresh && token && now - token.iat < 50 * 60) return token.jwt;
    const h = b64url.encode(JSON.stringify({ alg: "ES256", kid: apns.keyId })), c = b64url.encode(JSON.stringify({ iss: apns.teamId, iat: now }));
    token = { iat: now, jwt: `${h}.${c}.${b64url.encode(sign("sha256", Buffer.from(`${h}.${c}`), { key, dsaEncoding: "ieee-p1363" }))}` };
    return token.jwt;
  };
  const session = (url) => {
    let s = sessions.get(url);
    if (!s || s.closed || s.destroyed) { s = http2.connect(url); s.on("error", () => {}); s.on("close", () => { if (sessions.get(url) === s) sessions.delete(url); }); sessions.set(url, s); }
    return s;
  };
  const request = (url, headers, body, ms = 10_000) => new Promise((res, rej) => {
    const req = session(url).request(headers); const chunks = []; let status = 0;
    const t = setTimeout(() => { req.close(http2.constants.NGHTTP2_CANCEL); rej(new Error("apns timeout")); }, ms);
    req.on("response", (h) => { status = Number(h[":status"]); });
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => { clearTimeout(t); res({ status, body: Buffer.concat(chunks).toString() }); });
    req.on("error", (e) => { clearTimeout(t); rej(e); });
    req.end(body);
  });
  return {
    async send({ sandbox, token: device, message, ttl, urgency, topic }) {
      // Placeholder alert plus mutable-content: the app's notification extension decrypts and replaces title and body;
      // if that ever fails the placeholder shows – nothing readable was in transit
      const payload = JSON.stringify({ aps: { alert: { title: "metor", body: "New activity" }, "mutable-content": 1, sound: "default", ...(topic ? { "thread-id": topic } : {}) }, metor: message });
      if (Buffer.byteLength(payload) > MAX_PAYLOAD) return { status: 413, reason: "PayloadTooLarge" };
      const headers = (t) => ({ ":method": "POST", ":path": `/3/device/${device}`, authorization: `bearer ${t}`, "apns-topic": apns.topic, "apns-push-type": "alert",
        "apns-priority": urgency === "high" ? "10" : "5", "apns-expiration": String(ttl ? Math.floor(Date.now() / 1000) + ttl : 0), ...(topic ? { "apns-collapse-id": topic } : {}), "content-type": "application/json" });
      const url = sandbox ? apns.sandboxUrl : apns.url;
      let r = await request(url, headers(jwt()), payload);
      let reason = null; try { reason = JSON.parse(r.body).reason ?? null; } catch {}
      if (r.status === 403 && reason === "ExpiredProviderToken") { r = await request(url, headers(jwt(true)), payload); try { reason = JSON.parse(r.body).reason ?? null; } catch { reason = null; } }
      if (r.status === 200) return { status: 201 };
      if (r.status === 410 || (r.status === 400 && ["BadDeviceToken", "DeviceTokenNotForTopic"].includes(reason))) return { status: 410, reason };
      if (r.status === 413) return { status: 413, reason };
      if (r.status === 429) return { status: 429, reason };
      if (r.status === 403 || r.status === 401 || r.status === 400 || r.status === 404) return { status: 500, reason };   // our configuration, not the device
      return { status: 502, reason };
    },
    close() { for (const s of sessions.values()) s.close(); sessions.clear(); },
  };
}

// ---------- FCM: HTTP v1 with an OAuth2 access token from the service account (RS256 JWT) ----------
function fcmClient(fcm) {
  const sa = fcm.serviceAccount; const key = createPrivateKey(sa.private_key);
  let access = null;
  const accessToken = async () => {
    const now = Math.floor(Date.now() / 1000);
    if (access && access.exp - 60 > now) return access.token;
    const h = b64url.encode(JSON.stringify({ alg: "RS256", typ: "JWT" })), c = b64url.encode(JSON.stringify({ iss: sa.client_email, scope: "https://www.googleapis.com/auth/firebase.messaging", aud: sa.token_uri, iat: now, exp: now + 3600 }));
    const assertion = `${h}.${c}.${b64url.encode(sign("sha256", Buffer.from(`${h}.${c}`), key))}`;
    const r = await fetch(sa.token_uri, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }), signal: AbortSignal.timeout(10_000) });
    if (!r.ok) throw new Error(`fcm token ${r.status}`);
    const j = await r.json(); access = { token: j.access_token, exp: now + Number(j.expires_in ?? 3600) };
    return access.token;
  };
  return {
    async send({ token: device, message, ttl, urgency, topic }) {
      const body = JSON.stringify({ message: { token: device, android: { priority: urgency === "high" ? "high" : "normal", ttl: `${ttl}s`, ...(topic ? { collapse_key: topic } : {}) }, data: { v: "1", enc: message.enc, body: message.body } } });
      if (Buffer.byteLength(body) > MAX_PAYLOAD + 512) return { status: 413, reason: "PayloadTooLarge" };
      const r = await fetch(`${fcm.url}/v1/projects/${sa.project_id}/messages:send`, { method: "POST", headers: { authorization: `Bearer ${await accessToken()}`, "content-type": "application/json" }, body, signal: AbortSignal.timeout(10_000) });
      const text = await r.text(); let code = null; try { const e = JSON.parse(text).error; code = e?.details?.find((d) => d.errorCode)?.errorCode ?? e?.status ?? null; } catch {}
      if (r.ok) return { status: 201 };
      if (r.status === 404 || code === "UNREGISTERED" || (r.status === 400 && /registration token/i.test(text))) return { status: 410, reason: code };
      if (r.status === 429) return { status: 429, reason: code };
      if (r.status === 401 || r.status === 403) { access = null; return { status: 500, reason: code }; }
      if (r.status === 400) return { status: 500, reason: code };
      return { status: 502, reason: code };
    },
  };
}

// ---------- The server ----------
export function createRelay(cfg) {
  const apns = cfg.apns ? apnsClient(cfg.apns) : null, fcm = cfg.fcm ? fcmClient(cfg.fcm) : null, limits = limiter(cfg);
  const readBody = (req) => new Promise((res, rej) => { const chunks = []; let n = 0; req.on("data", (c) => { n += c.length; if (n > MAX_BODY) { rej(Object.assign(new Error("too large"), { code: 413 })); req.destroy(); } else chunks.push(c); }); req.on("end", () => res(Buffer.concat(chunks))); req.on("error", rej); });
  const server = http.createServer(async (req, res) => {
    const started = Date.now();
    try {
      const url = new URL(req.url ?? "/", "http://relay");
      if (url.pathname === "/health") return json(res, 200, { ok: true, apns: !!apns, fcm: !!fcm });
      const m = /^\/v1\/(apns|apns-sandbox|fcm)\/([A-Za-z0-9_:.-]{16,512})$/.exec(url.pathname);
      if (!m) return json(res, 404, { error: "unknown route" });
      if (req.method !== "POST") return json(res, 405, { error: "POST only" }, { allow: "POST" });
      const [, platform, device] = m;
      const client = platform === "fcm" ? fcm : apns;
      if (!client) return json(res, 503, { error: `${platform} is not configured on this relay` });
      if (String(req.headers["content-encoding"] ?? "") !== "aes128gcm") return json(res, 415, { error: "Content-Encoding aes128gcm required" });
      if (Number(req.headers["content-length"] ?? 0) > MAX_BODY) return json(res, 413, { error: `at most ${MAX_BODY} bytes` });
      const vapid = parseVapid(req.headers);
      if (!vapid || !verifyVapid(vapid, cfg.origin)) return json(res, 401, { error: "VAPID signature missing or invalid" }, { "www-authenticate": "vapid" });
      const ip = String(req.headers["x-forwarded-for"] ?? "").split(",")[0].trim() || req.socket.remoteAddress || "?";
      const l = limits.take(device, ip);
      if (!l.ok) return json(res, 429, { error: "over the limit" }, { "retry-after": String(l.retry) });
      let body; try { body = await readBody(req); } catch (e) { return json(res, e.code === 413 ? 413 : 400, { error: e.message }); }
      if (!body.length) return json(res, 400, { error: "empty body" });
      const ttl = Math.min(Math.max(Number(req.headers.ttl ?? 86_400) || 0, 0), 28 * 86_400);
      const urgency = ["very-low", "low", "normal", "high"].includes(req.headers.urgency) ? req.headers.urgency : "normal";
      const topic = /^[A-Za-z0-9_-]{1,32}$/.test(String(req.headers.topic ?? "")) ? String(req.headers.topic) : null;
      const r = await client.send({ sandbox: platform === "apns-sandbox", token: device, message: { v: 1, enc: "aes128gcm", body: body.toString("base64") }, ttl, urgency, topic });
      console.log(`${platform} ${tokenTag(device)} ${r.status}${r.reason ? ` ${r.reason}` : ""} ${Date.now() - started}ms`);
      if (r.status === 201) return json(res, 201, { ok: true });
      return json(res, r.status, { error: r.reason ?? http.STATUS_CODES[r.status] ?? "failed" }, r.status === 429 ? { "retry-after": "60" } : {});
    } catch (e) {
      console.error(`error ${e.message}`);
      if (!res.headersSent) json(res, 502, { error: "upstream failed" });
    }
  });
  server.on("close", () => apns?.close());
  return server;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {
  const cfg = configFromEnv();
  const server = createRelay(cfg);
  server.listen(cfg.port, cfg.host, () => console.log(`metor push relay on ${cfg.host}:${cfg.port} (apns: ${cfg.apns ? "on" : "off"}, fcm: ${cfg.fcm ? "on" : "off"}, audience: ${cfg.origin || "any"})`));
  const stop = () => { server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 3000).unref(); };
  process.on("SIGTERM", stop); process.on("SIGINT", stop);
}
