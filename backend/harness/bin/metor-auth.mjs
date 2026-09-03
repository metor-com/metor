// metor-auth – sign-in without passwords (ADR-0012). The gateway hands a session to every device
// that presents a one-time claim: the setup link printed by `metor auth link` (or by the supervisor
// on first boot), or a pairing link / QR code / short code created on a device that is already
// signed in. Only hashes are stored – a bot that reads the file gains nothing; the raw secret lives
// in the browser cookie only. One JSON file, shared by gateway, CLI and supervisor.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { join } from "node:path";

const STORE_DIR = process.env.METOR_AUTH_DIR ?? join(process.env.METOR_WORKSPACE_DIR ?? "/workspace", ".metor");
const FILE = join(STORE_DIR, "auth.json");
export const AUTH_OFF = process.env.METOR_AUTH === "off";   // only behind your own login or for local experiments
export const COOKIE = "metor_session";
const SESSION_DAYS = 365;
const TTL = { setup: 24 * 60 * 60 * 1000, pair: 2 * 60 * 1000 };
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";   // no 0/O/1/I – the code is typed on a phone

const now = () => Date.now();
const sha = (s) => createHash("sha256").update(String(s)).digest("hex");
const same = (a, b) => typeof a === "string" && typeof b === "string" && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
export const baseUrl = () => (process.env.METOR_WATCH_BASE ?? "").replace(/\/$/, "") || "http://127.0.0.1:6010";

function load() {
  try { return { sessions: [], claims: [], ...JSON.parse(readFileSync(FILE, "utf8")) }; } catch { return { sessions: [], claims: [] }; }
}
function save(db) {
  mkdirSync(STORE_DIR, { recursive: true });
  db.claims = db.claims.filter((c) => c.expiresAt > now());
  const tmp = `${FILE}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(db, null, 2) + "\n", { mode: 0o600 });
  renameSync(tmp, FILE);
}

// ---------- Claims: one-time tokens (setup link 24 h, pairing 2 min) ----------
function newCode() { const b = randomBytes(8); let s = ""; for (let i = 0; i < 8; i += 1) s += CODE_ALPHABET[b[i] % CODE_ALPHABET.length]; return `${s.slice(0, 4)}-${s.slice(4)}`; }
const normalizeCode = (c) => { const s = String(c ?? "").toUpperCase().replace(/[^A-Z0-9]/g, ""); return s.length === 8 ? `${s.slice(0, 4)}-${s.slice(4)}` : null; };
export function createClaim(kind, { createdBy = null } = {}) {
  if (!TTL[kind]) throw new Error(`unknown claim kind ${kind}`);
  const db = load();
  const token = randomBytes(32).toString("base64url");
  const code = kind === "pair" ? newCode() : null;
  const expiresAt = now() + TTL[kind];
  db.claims.push({ id: randomBytes(6).toString("hex"), kind, hash: sha(token), codeHash: code ? sha(code) : null, createdAt: now(), expiresAt, createdBy });
  save(db);
  return { token, code, url: `${baseUrl()}/bots/auth/claim?token=${token}`, expiresAt };
}
export const hasSessions = () => load().sessions.length > 0;
export const hasOpenClaim = (kind) => load().claims.some((c) => c.kind === kind && c.expiresAt > now());

// Redeem a claim by link token or by pairing code → a new session; every claim works once
export function claimSession({ token, code } = {}, { userAgent, ip } = {}) {
  const db = load();
  const t = token ? sha(token) : null, c = normalizeCode(code); const ch = c ? sha(c) : null;
  const i = db.claims.findIndex((cl) => cl.expiresAt > now() && ((t && same(cl.hash, t)) || (ch && same(cl.codeHash, ch))));
  if (i < 0) return null;
  const claim = db.claims.splice(i, 1)[0];
  const secret = randomBytes(32).toString("base64url");
  const session = { id: randomBytes(6).toString("hex"), hash: sha(secret), name: deviceName(userAgent), createdAt: now(), lastSeenAt: now(), ip: ip ?? null, via: claim.kind };
  db.sessions.push(session); save(db);
  return { secret, session };
}

// ---------- Sessions ----------
export function cookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie ?? "").split(/;\s*/)) { const i = part.indexOf("="); if (i > 0) out[part.slice(0, i)] = part.slice(i + 1); }
  return out;
}
export function sessionOf(req) {
  if (AUTH_OFF) return { id: "off", name: "sign-in disabled (METOR_AUTH=off)" };
  const raw = cookies(req)[COOKIE]; if (!raw) return null;
  const h = sha(raw); const db = load();
  const s = db.sessions.find((x) => same(x.hash, h)); if (!s) return null;
  if (now() - s.lastSeenAt > 60_000) { s.lastSeenAt = now(); save(db); }   // one write per minute at most
  return s;
}
export const listSessions = () => load().sessions.map(({ hash, ...s }) => s);
export function revokeSession(id) { const db = load(); const n = db.sessions.length; db.sessions = db.sessions.filter((s) => s.id !== id); if (db.sessions.length === n) return false; save(db); return true; }
export function setCookieHeader(secret, req) {
  const secure = req.headers["x-forwarded-proto"] === "https";   // the real scheme of THIS request (Caddy sets the header); a plain-http local call must not get a Secure cookie
  return `${COOKIE}=${secret}; Path=/bots; Max-Age=${SESSION_DAYS * 86400}; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
}
export const clearCookieHeader = () => `${COOKIE}=; Path=/bots; Max-Age=0; HttpOnly; SameSite=Lax`;

// ---------- Brute-force brake: 10 failed redemptions per address and 10 minutes ----------
const failures = new Map();
export function clientIp(req) { const xf = String(req.headers["x-forwarded-for"] ?? "").split(",")[0].trim(); return xf || req.socket?.remoteAddress || "?"; }
export function tooManyAttempts(ip) { const t = now(); const list = (failures.get(ip) ?? []).filter((x) => t - x < 10 * 60_000); failures.set(ip, list); return list.length >= 10; }
export function noteFailure(ip) { (failures.get(ip) ?? failures.set(ip, []).get(ip)).push(now()); }

// ---------- Helpers ----------
export function deviceName(ua = "") {
  const os = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android" : /Mac OS X/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "device";
  const br = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : /curl/.test(ua) ? "curl" : "browser";
  return `${br} on ${os}`;
}
// QR codes via the `qrcode` package in the image; loaded lazily so the module works without it
export async function qrDataUrl(text) { const { default: QRCode } = await import("qrcode"); return QRCode.toDataURL(text, { margin: 1, width: 240 }); }
export async function qrTerminal(text) { const { default: QRCode } = await import("qrcode"); return QRCode.toString(text, { type: "terminal", small: true }); }

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
// The page every device without a session gets (plain HTML, no scripts, no assets)
export function signInPage({ error = null } = {}) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>metor – sign in</title>
<style>
 body{font:16px/1.5 -apple-system,system-ui,sans-serif;margin:0;background:#f4f4f5;color:#18181b;display:flex;min-height:100vh;align-items:center;justify-content:center}
 main{background:#fff;border:1px solid #e4e4e7;border-radius:16px;padding:28px 28px 24px;max-width:26rem;margin:16px}
 h1{margin:0 0 6px;font-size:20px} p{margin:8px 0;color:#52525b} code{background:#f4f4f5;padding:2px 6px;border-radius:6px;font-size:14px}
 form{display:flex;gap:8px;margin-top:14px} input{flex:1;min-width:0;padding:10px 12px;border:1px solid #d4d4d8;border-radius:10px;font:inherit;font-family:ui-monospace,monospace;text-transform:uppercase}
 button{padding:10px 16px;border:0;border-radius:10px;background:#18181b;color:#fff;font:inherit;cursor:pointer}
 .err{color:#b91c1c} ol{padding-left:20px;color:#52525b} li{margin:4px 0}
</style></head><body><main>
<h1>metor</h1>
<p>This computer is locked. Sign in from a device that already has access, or with the setup link.</p>
${error ? `<p class="err">${esc(error)}</p>` : ""}
<ol>
<li><strong>Setup link</strong>: shown by the installer and by <code>metor auth link</code> inside the box – open it on this device.</li>
<li><strong>From a signed-in device</strong>: open <em>Devices → Link a device</em> there and scan the QR code with this phone, or enter the pairing code here:</li>
</ol>
<form method="post" action="/bots/auth/code"><input name="code" placeholder="XXXX-XXXX" autocomplete="one-time-code" autocapitalize="characters" spellcheck="false" required><button type="submit">Sign in</button></form>
</main></body></html>`;
}
