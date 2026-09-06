// Tests for the push relay against stand-ins for APNs (HTTP/2) and FCM (HTTP/1 + token endpoint).
// The Web Push side is built here exactly as the gateway's web-push library sends it.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import http2 from "node:http2";
import { generateKeyPairSync, sign } from "node:crypto";
import { createRelay } from "../relay.mjs";

const b64url = (b) => Buffer.from(b).toString("base64url");
const listen = (server) => new Promise((res) => server.listen(0, "127.0.0.1", () => res(`http://127.0.0.1:${server.address().port}`)));

// ---------- stand-ins ----------
const apnsLog = [];
const apnsFake = http2.createServer((req, res) => {
  const chunks = []; req.on("data", (c) => chunks.push(c)); req.on("end", () => {
    const entry = { headers: { ...req.headers }, body: JSON.parse(Buffer.concat(chunks).toString()) }; apnsLog.push(entry);
    const token = req.headers[":path"].split("/").pop();
    const reply = (code, obj) => { res.writeHead(code, { "content-type": "application/json", "apns-id": "test" }); res.end(obj ? JSON.stringify(obj) : ""); };
    if (token.startsWith("gone")) return reply(410, { reason: "Unregistered" });
    if (token.startsWith("badtoken")) return reply(400, { reason: "BadDeviceToken" });
    if (token.startsWith("expiredonce")) { if (!apnsFake.expiredOnce) { apnsFake.expiredOnce = true; return reply(403, { reason: "ExpiredProviderToken" }); } return reply(200); }
    if (token.startsWith("toomany")) return reply(429, { reason: "TooManyRequests" });
    if (token.startsWith("broken")) return reply(500, { reason: "InternalServerError" });
    reply(200);
  });
});
const fcmLog = [];
const fcmFake = http.createServer((req, res) => {
  const chunks = []; req.on("data", (c) => chunks.push(c)); req.on("end", () => {
    const body = Buffer.concat(chunks).toString();
    if (req.url === "/token") { res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify({ access_token: "fcm-access", expires_in: 3600 })); }
    const msg = JSON.parse(body); fcmLog.push({ headers: req.headers, message: msg.message });
    const token = msg.message.token;
    const reply = (code, obj) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };
    if (token.startsWith("gone")) return reply(404, { error: { code: 404, status: "NOT_FOUND", details: [{ "@type": "type.googleapis.com/google.firebase.fcm.v1.FcmError", errorCode: "UNREGISTERED" }] } });
    if (token.startsWith("invalid")) return reply(400, { error: { code: 400, status: "INVALID_ARGUMENT", message: "The registration token is not a valid FCM registration token" } });
    reply(200, { name: "projects/test/messages/1" });
  });
});

// ---------- the sender: VAPID like the gateway ----------
const vapid = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const jwk = vapid.publicKey.export({ format: "jwk" });
const vapidPublic = b64url(Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, "base64url"), Buffer.from(jwk.y, "base64url")]));
function vapidToken({ aud, exp = Math.floor(Date.now() / 1000) + 12 * 3600, key = vapid.privateKey } = {}) {
  const h = b64url(JSON.stringify({ typ: "JWT", alg: "ES256" })), c = b64url(JSON.stringify({ aud, exp, sub: "mailto:test@example.com" }));
  return `${h}.${c}.${b64url(sign("sha256", Buffer.from(`${h}.${c}`), { key, dsaEncoding: "ieee-p1363" }))}`;
}

let relayUrl, relay;
const ORIGIN = "https://push.test";
const apnsKey = generateKeyPairSync("ec", { namedCurve: "prime256v1" }).privateKey.export({ type: "pkcs8", format: "pem" });
const fcmKey = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" });

before(async () => {
  const apnsUrl = await listen(apnsFake), fcmUrl = await listen(fcmFake);
  relay = createRelay({
    origin: ORIGIN, dailyLimit: 3, burstLimit: 10, ipLimit: 1000,
    apns: { key: apnsKey, keyId: "KEY123", teamId: "TEAM123", topic: "com.metor.mobile", url: apnsUrl, sandboxUrl: apnsUrl },
    fcm: { serviceAccount: { project_id: "test", client_email: "relay@test", private_key: fcmKey, token_uri: `${fcmUrl}/token` }, url: fcmUrl },
  });
  relayUrl = await listen(relay);
});
after(() => { relay.close(); apnsFake.close(); fcmFake.close(); });

const ciphertext = Buffer.from("aes128gcm-ciphertext-" + "x".repeat(200));
function push(path, { body = ciphertext, auth, headers = {}, method = "POST" } = {}) {
  const t = auth ?? `vapid t=${vapidToken({ aud: ORIGIN })}, k=${vapidPublic}`;
  return fetch(relayUrl + path, { method, body: method === "POST" ? body : undefined, headers: { "content-encoding": "aes128gcm", "content-type": "application/octet-stream", ttl: "60", urgency: "high", ...(t ? { authorization: t } : {}), ...headers } });
}

test("health", async () => { const r = await fetch(`${relayUrl}/health`); assert.equal(r.status, 200); assert.deepEqual(await r.json(), { ok: true, apns: true, fcm: true }); });
test("unknown route and method", async () => {
  assert.equal((await fetch(`${relayUrl}/v2/apns/abc`)).status, 404);
  assert.equal((await push("/v1/apns/" + "a".repeat(64), { method: "GET" })).status, 405);
});
test("apns: forwarded with the gateway's headers mapped, still encrypted", async () => {
  const token = "a1b2".repeat(16);
  const r = await push(`/v1/apns/${token}`, { headers: { topic: "approval-bot1" } });
  assert.equal(r.status, 201);
  const sent = apnsLog.at(-1);
  assert.equal(sent.headers[":path"], `/3/device/${token}`);
  assert.equal(sent.headers["apns-topic"], "com.metor.mobile");
  assert.equal(sent.headers["apns-priority"], "10");
  assert.equal(sent.headers["apns-push-type"], "alert");
  assert.equal(sent.headers["apns-collapse-id"], "approval-bot1");
  const exp = Number(sent.headers["apns-expiration"]); assert.ok(exp >= Math.floor(Date.now() / 1000) + 55 && exp <= Math.floor(Date.now() / 1000) + 61);
  const [h, c] = sent.headers.authorization.replace(/^bearer /, "").split(".").slice(0, 2).map((s) => JSON.parse(Buffer.from(s, "base64url")));
  assert.deepEqual(h, { alg: "ES256", kid: "KEY123" }); assert.equal(c.iss, "TEAM123");
  assert.equal(sent.body.aps["mutable-content"], 1); assert.equal(sent.body.aps.alert.title, "metor");
  assert.deepEqual(sent.body.metor, { v: 1, enc: "aes128gcm", body: ciphertext.toString("base64") });
});
test("apns: sandbox route, normal urgency → priority 5, no topic", async () => {
  const r = await push(`/v1/apns-sandbox/${"c".repeat(64)}`, { headers: { urgency: "normal" } });
  assert.equal(r.status, 201);
  const sent = apnsLog.at(-1); assert.equal(sent.headers["apns-priority"], "5"); assert.equal(sent.headers["apns-collapse-id"], undefined);
});
test("apns: gone and bad tokens answer 410, so the gateway drops the subscription", async () => {
  assert.equal((await push(`/v1/apns/gone${"0".repeat(60)}`)).status, 410);
  assert.equal((await push(`/v1/apns/badtoken${"0".repeat(56)}`)).status, 410);
});
test("apns: an expired provider token is renewed once", async () => {
  const before = apnsLog.length;
  assert.equal((await push(`/v1/apns/expiredonce${"0".repeat(53)}`)).status, 201);
  assert.equal(apnsLog.length - before, 2);
});
test("apns: upstream throttling and failures are passed on as 429 / 502", async () => {
  assert.equal((await push(`/v1/apns/toomany${"0".repeat(57)}`)).status, 429);
  assert.equal((await push(`/v1/apns/broken${"0".repeat(58)}`)).status, 502);
});
test("fcm: data message with the ciphertext, priority and ttl", async () => {
  const token = "dEvIcE:APA91b" + "f".repeat(40);
  const r = await push(`/v1/fcm/${token}`, { headers: { ttl: "120", topic: "reply-bot1" } });
  assert.equal(r.status, 201);
  const sent = fcmLog.at(-1);
  assert.equal(sent.headers.authorization, "Bearer fcm-access");
  assert.equal(sent.message.token, token);
  assert.deepEqual(sent.message.android, { priority: "high", ttl: "120s", collapse_key: "reply-bot1" });
  assert.deepEqual(sent.message.data, { v: "1", enc: "aes128gcm", body: ciphertext.toString("base64") });
});
test("fcm: unregistered and invalid tokens answer 410", async () => {
  assert.equal((await push(`/v1/fcm/gone${"0".repeat(40)}`)).status, 410);
  assert.equal((await push(`/v1/fcm/invalid${"0".repeat(40)}`)).status, 410);
});
test("vapid: missing, bad signature, wrong audience, expired → 401", async () => {
  const path = `/v1/apns/${"e".repeat(64)}`;
  assert.equal((await push(path, { auth: "" })).status, 401);
  const other = generateKeyPairSync("ec", { namedCurve: "prime256v1" }).privateKey;
  assert.equal((await push(path, { auth: `vapid t=${vapidToken({ aud: ORIGIN, key: other })}, k=${vapidPublic}` })).status, 401);
  assert.equal((await push(path, { auth: `vapid t=${vapidToken({ aud: "https://elsewhere.test" })}, k=${vapidPublic}` })).status, 401);
  assert.equal((await push(path, { auth: `vapid t=${vapidToken({ aud: ORIGIN, exp: Math.floor(Date.now() / 1000) - 10 })}, k=${vapidPublic}` })).status, 401);
});
test("vapid: the older WebPush + Crypto-Key form is accepted too", async () => {
  const r = await push(`/v1/apns/${"f".repeat(64)}`, { auth: `WebPush ${vapidToken({ aud: ORIGIN })}`, headers: { "crypto-key": `p256ecdsa=${vapidPublic}` } });
  assert.equal(r.status, 201);
});
test("body: encoding required, size capped", async () => {
  const path = `/v1/apns/${"9".repeat(64)}`;
  assert.equal((await push(path, { headers: { "content-encoding": "identity" } })).status, 415);
  assert.equal((await push(path, { body: Buffer.alloc(5000) })).status, 413);
  assert.equal((await push(path, { body: Buffer.alloc(0) })).status, 400);
});
test("limits: the daily limit per device answers 429 with Retry-After", async () => {
  const path = `/v1/apns/${"7".repeat(64)}`;
  for (let i = 0; i < 3; i++) assert.equal((await push(path)).status, 201);
  const r = await push(path); assert.equal(r.status, 429); assert.ok(Number(r.headers.get("retry-after")) > 0);
});
test("a relay without fcm answers 503 on the fcm route", async () => {
  const bare = createRelay({ origin: ORIGIN, dailyLimit: 10, burstLimit: 10, ipLimit: 10, apns: null, fcm: null });
  const url = await listen(bare);
  const r = await fetch(`${url}/v1/fcm/${"b".repeat(40)}`, { method: "POST", body: ciphertext, headers: { "content-encoding": "aes128gcm" } });
  assert.equal(r.status, 503); bare.close();
});
