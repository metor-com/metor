// metor-connectors – MCP servers configured in the interface (Settings → Connectors), valid for
// every bot (ADR-0014). Store: /workspace/.metor/connectors.json – secrets (tokens in env or
// headers) live there in the clear, like the runtimes' own config inside the box (ADR-0004);
// the API masks them on the way out. Both runtimes get the connectors when a bot starts:
// Claude Code through the bot's mcp.json (writeMcpConfig), Codex through -c mcp_servers.* overrides.
// Per-bot selection is a later step – forBot() is the seam for it.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";

const STORE_DIR = process.env.METOR_AUTH_DIR ?? join(process.env.METOR_WORKSPACE_DIR ?? "/workspace", ".metor");
const FILE = join(STORE_DIR, "connectors.json");
const TEMPLATES = process.env.METOR_TEMPLATES_DIR
  ?? (process.env.METOR_INSIDE_BOX === "1" ? "/usr/local/lib/metor/templates" : join(dirname(fileURLToPath(import.meta.url)), "..", "templates"));
export const BUILTIN_KEYS = new Set(["browser", "routines"]);   // MCP servers every bot has anyway
export const MASK = "••••••••";
const SECRET_RE = /token|secret|key|password|passwd|authorization|cookie/i;
const TRANSPORTS = new Set(["stdio", "http", "sse"]);

export function load() { try { return JSON.parse(readFileSync(FILE, "utf8")).connectors ?? []; } catch { return []; } }
function save(list) {
  mkdirSync(STORE_DIR, { recursive: true });
  const tmp = `${FILE}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify({ connectors: list }, null, 2) + "\n", { mode: 0o600 });
  renameSync(tmp, FILE);
}

// The curated list (templates/connectors.json): well-known servers with what they need
export function directory() { try { return JSON.parse(readFileSync(join(TEMPLATES, "connectors.json"), "utf8")); } catch { return []; } }

export const validKey = (k) => typeof k === "string" && /^[a-z0-9][a-z0-9_-]{0,39}$/.test(k) && !BUILTIN_KEYS.has(k);
export const keyFor = (name) => String(name ?? "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);

// "npx -y @scope/pkg --flag 'a b'" → ["npx", "-y", "@scope/pkg", "--flag", "a b"]
export function splitCommand(line) {
  const out = []; let cur = "", quote = null, has = false;
  for (const ch of String(line ?? "")) {
    if (quote) { if (ch === quote) quote = null; else cur += ch; }
    else if (ch === '"' || ch === "'") { quote = ch; has = true; }
    else if (/\s/.test(ch)) { if (cur || has) { out.push(cur); cur = ""; has = false; } }
    else cur += ch;
  }
  if (cur || has) out.push(cur);
  return out;
}
// "KEY=value" lines or an object → { KEY: "value" }; "Name: value" lines for headers
function toMap(input, sep) {
  const out = {};
  if (input && typeof input === "object" && !Array.isArray(input)) { for (const [k, v] of Object.entries(input)) if (String(k).trim()) out[String(k).trim()] = String(v ?? ""); return out; }
  for (const line of String(input ?? "").split("\n")) {
    const i = line.indexOf(sep); if (i <= 0) continue;
    const k = line.slice(0, i).trim(), v = line.slice(i + 1).trim();
    if (k) out[k] = v;
  }
  return out;
}
// A masked value coming back from the interface means "keep what is stored"
function unmask(next, prev = {}) { for (const k of Object.keys(next)) if (next[k] === MASK) next[k] = prev[k] ?? ""; return next; }
export function mask(rec) {
  const hide = (m = {}) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, v && SECRET_RE.test(k) ? MASK : v]));
  return { ...rec, ...(rec.env ? { env: hide(rec.env) } : {}), ...(rec.headers ? { headers: hide(rec.headers) } : {}) };
}

// What the interface sends → a clean record, or { error }
export function normalize(input, existing = null) {
  const name = String(input?.name ?? "").trim().replace(/\s+/g, " ");
  if (!name || name.length > 60) return { error: "name missing or longer than 60 characters" };
  const key = existing?.key ?? (String(input?.key ?? "").trim() || keyFor(name));
  if (!validKey(key)) return { error: `invalid key "${key}" (a-z, 0-9, hyphen, at most 40; browser and routines are taken)` };
  const transport = TRANSPORTS.has(input?.transport) ? input.transport : null;
  if (!transport) return { error: "transport must be stdio, http or sse" };
  const rec = { id: existing?.id ?? randomBytes(4).toString("hex"), key, name, transport, enabled: input?.enabled !== false,
    approval: input?.approval === true,   // ask in the interface before every call (default: pre-approved, ADR-0004)
    source: input?.source === "directory" ? "directory" : "custom",
    ...(input?.directoryId ? { directoryId: String(input.directoryId).slice(0, 40) } : {}),
    createdAt: existing?.createdAt ?? new Date().toISOString(), updatedAt: new Date().toISOString() };
  if (transport === "stdio") {
    const parts = Array.isArray(input?.args) ? [String(input?.command ?? ""), ...input.args.map(String)] : splitCommand(input?.command);
    if (!parts[0]) return { error: "command missing" };
    rec.command = parts[0]; rec.args = parts.slice(1);
    rec.env = unmask(toMap(input?.env, "="), existing?.env);
  } else {
    let url; try { url = new URL(String(input?.url ?? "").trim()); if (!/^https?:$/.test(url.protocol)) throw new Error(); } catch { return { error: "url must start with http:// or https://" }; }
    rec.url = url.href;
    rec.headers = unmask(toMap(input?.headers, ":"), existing?.headers);
  }
  return rec;
}

export const list = () => load().map(mask);
export function add(input) {
  const all = load(); const rec = normalize(input); if (rec.error) return rec;
  if (all.some((c) => c.key === rec.key)) return { error: `key "${rec.key}" is already used – pick another name or key` };
  all.push(rec); save(all); return { ok: true, connector: mask(rec) };
}
export function update(id, input) {
  const all = load(); const i = all.findIndex((c) => c.id === id); if (i < 0) return { error: "connector not found" };
  const rec = normalize({ ...all[i], ...input }, all[i]); if (rec.error) return rec;
  all[i] = rec; save(all); return { ok: true, connector: mask(rec) };
}
export function remove(id) {
  const all = load(); const n = all.length; const rest = all.filter((c) => c.id !== id);
  if (rest.length === n) return { error: "connector not found" };
  save(rest); return { ok: true };
}

// ---------- What a bot gets (per-bot selection later; today every enabled connector) ----------
export const forBot = (_bot) => load().filter((c) => c.enabled);
const nonEmpty = (m) => m && Object.keys(m).length ? m : null;
// Claude Code: entries for the bot's mcp.json (--mcp-config)
export function claudeServers(bot) {
  const out = {};
  for (const c of forBot(bot)) {
    out[c.key] = c.transport === "stdio"
      ? { command: c.command, args: c.args, ...(nonEmpty(c.env) ? { env: c.env } : {}) }
      : { type: c.transport, url: c.url, ...(nonEmpty(c.headers) ? { headers: c.headers } : {}) };
  }
  return out;
}
// Claude Code: the permission rules that spare a pre-approved connector the approval card
// (same pattern as mcp__browser__* in the bot's settings.json)
export const claudeAllowedTools = (bot) => forBot(bot).filter((c) => !c.approval).map((c) => `mcp__${c.key}__*`);
// Codex: -c overrides in TOML (JSON strings are valid TOML basic strings). Remote servers go
// through `url` for both http and sse – Codex speaks streamable HTTP; an SSE-only server may not answer.
export function codexOverrides(bot) {
  const args = []; const q = (v) => JSON.stringify(String(v));
  const table = (m) => `{${Object.entries(m).map(([k, v]) => `${q(k)}=${q(v)}`).join(",")}}`;
  for (const c of forBot(bot)) {
    const p = `mcp_servers.${c.key}`;
    if (c.transport === "stdio") {
      args.push("-c", `${p}.command=${q(c.command)}`, "-c", `${p}.args=${JSON.stringify(c.args)}`);
      if (nonEmpty(c.env)) args.push("-c", `${p}.env=${table(c.env)}`);
    } else {
      args.push("-c", `${p}.url=${q(c.url)}`);
      if (nonEmpty(c.headers)) args.push("-c", `${p}.http_headers=${table(c.headers)}`);
    }
  }
  return args;
}
