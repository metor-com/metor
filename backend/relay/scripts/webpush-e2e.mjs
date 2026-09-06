// End to end with the gateway's own library: web-push (the version the box image installs) sends
// a notification the way metor-push.mjs does, to a subscription whose endpoint is this relay; a
// stand-in APNs receives the wrapped message; what APNs would hand the app is decrypted with the
// subscription's private key and must equal the original payload. web-push always speaks https,
// so a self-signed TLS front sits before the relay for this run.
//   npm install --no-save web-push@3.6.7 && node scripts/webpush-e2e.mjs
import webPush from "web-push";
import ece from "http_ece";
import http from "node:http";
import http2 from "node:http2";
import https from "node:https";
import { createECDH, generateKeyPairSync, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRelay } from "../relay.mjs";

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
const listen = (s, port = 0) => new Promise((r) => s.listen(port, "127.0.0.1", () => r(`http://127.0.0.1:${s.address().port}`)));

// stand-in APNs (HTTP/2) that keeps what it received
let received = null;
const apns = http2.createServer((req, res) => { const c = []; req.on("data", (d) => c.push(d)); req.on("end", () => { received = { headers: req.headers, body: JSON.parse(Buffer.concat(c)) }; res.writeHead(200); res.end(); }); });
const apnsUrl = await listen(apns);

// the relay behind a self-signed TLS front
const dir = mkdtempSync(join(tmpdir(), "metor-relay-"));
execFileSync("openssl", ["req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1", "-nodes", "-keyout", join(dir, "key.pem"), "-out", join(dir, "cert.pem"), "-days", "1", "-subj", "/CN=127.0.0.1"], { stdio: "ignore" });
const tlsPort = 40000 + Math.floor(Math.random() * 20000), origin = `https://127.0.0.1:${tlsPort}`;
const relay = createRelay({ origin, dailyLimit: 10, burstLimit: 10, ipLimit: 100, fcm: null,
  apns: { key: generateKeyPairSync("ec", { namedCurve: "prime256v1" }).privateKey.export({ type: "pkcs8", format: "pem" }), keyId: "KEY", teamId: "TEAM", topic: "com.metor.mobile", url: apnsUrl, sandboxUrl: apnsUrl } });
const relayHttp = await listen(relay);
const tls = https.createServer({ key: readFileSync(join(dir, "key.pem")), cert: readFileSync(join(dir, "cert.pem")) }, (req, res) => {
  const up = http.request(relayHttp + req.url, { method: req.method, headers: req.headers }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
  req.pipe(up);
});
await listen(tls, tlsPort);

// the device: a P-256 key pair and a 16-byte auth secret, as a browser or the app makes them
const device = createECDH("prime256v1"); device.generateKeys(); const auth = randomBytes(16);
const subscription = { endpoint: `${origin}/v1/apns/${"ab".repeat(32)}`, keys: { p256dh: device.getPublicKey().toString("base64url"), auth: auth.toString("base64url") } };
// the gateway: VAPID keys of the installation, the call as metor-push.mjs makes it
const vapid = webPush.generateVAPIDKeys();
const payload = JSON.stringify({ kind: "approval", bot: "gemini", title: "Gemini needs an approval", body: "Run: npm test", url: "/bots/#/gemini" });
const r = await webPush.sendNotification(subscription, payload, { TTL: 3600, urgency: "high", vapidDetails: { subject: "mailto:ops@example.com", publicKey: vapid.publicKey, privateKey: vapid.privateKey } });
// the app: decrypt what APNs delivered
const clear = ece.decrypt(Buffer.from(received.body.metor.body, "base64"), { version: "aes128gcm", privateKey: device, authSecret: auth }).toString();
const ok = r.statusCode === 201 && received.headers["apns-priority"] === "10" && received.headers["apns-topic"] === "com.metor.mobile" && received.body.aps["mutable-content"] === 1 && clear === payload;
console.log(`relay ${r.statusCode}, apns priority ${received.headers["apns-priority"]}, decrypted on the device: ${clear}`);
console.log(ok ? "web-push end to end: OK" : "web-push end to end: MISMATCH");
relay.close(); apns.close(); tls.close();
process.exit(ok ? 0 : 1);
