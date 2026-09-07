// metor-harness – the harness registry (ADR-0011): the single source of knowledge about which
// runtimes exist, which models they run, how a bot directory is laid out and
// how login/setup work. UI term "Runtime", the code term stays `harness` (GLOSSARY).
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { claudeServers, copilotServers, geminiServers } from "./metor-connectors.mjs";

// Port scheme per display – shared by metor.mjs and the adapters
export const ports = (d) => ({ display: d, vnc: 5900 + d, novnc: 6000 + d, cdp: 9200 + d, ttyd: 7100 + d });

export const HARNESSES = {
  "claude-stream": {
    id: "claude-stream",
    label: "Claude Code",
    kind: "ipc-host",                      // seam: future runtimes may be kind "http" (OpenCode)
    adapterModule: "./metor-host-claude.mjs",
    // Aliases: Claude Code resolves each to the newest model of that family, so the list stays
    // current with the CLI (verified 2026-09-05: `fable` → claude-fable-5-1 with a subscription).
    // The labels carry the version: from the CLI's model picker (SDK supportedModels(), no turn
    // needed, cached per CLI version) and – since the picker can lag the alias – from what the bots'
    // own answers report (recordSeenModel), which wins.
    models: [
      { id: "fable", label: "Fable" },
      { id: "opus", label: "Opus" },
      { id: "sonnet", label: "Sonnet", default: true },
      { id: "haiku", label: "Haiku" },
    ],
    async listModels() {
      const db = readModelsFile(); const h = db["claude-stream"] ?? {};
      const cli = (spawnSync("claude", ["--version"], { encoding: "utf8" }).stdout ?? "").trim() || "?";
      let resolved = h.cli === cli && h.resolved ? h.resolved : null;
      if (!resolved) {
        resolved = await pickerVersions().catch(() => null);
        if (resolved) { db["claude-stream"] = { cli, resolved, seen: {} }; writeModelsFile(db); h.seen = {}; }   // a new CLI: what was seen belongs to the old one
      }
      return this.models.map((m) => {
        const id = h.seen?.[m.id]?.id ?? null;   // the id a bot's answer reported for this alias – the only real one we have
        return { ...m, label: (id && prettyModel(id)) ?? resolved?.[m.id] ?? m.label, ...(id ? { resolved: id } : {}) };
      });
    },
    roleFile: "CLAUDE.md",
    scaffold(dir, bot, templatesDir) {
      mkdirSync(join(dir, ".claude"), { recursive: true });
      const tpl = readFileSync(join(templatesDir, "CLAUDE.md"), "utf8")
        .replaceAll("{{NAME}}", bot.name).replaceAll("{{TITLE}}", bot.title ?? bot.name).replaceAll("{{ROLE}}", bot.role);
      writeFileSync(join(dir, "CLAUDE.md"), tpl);
      writeFileSync(join(dir, ".claude", "settings.json"), readFileSync(join(templatesDir, "settings.json"), "utf8"));
    },
    writeMcpConfig(dir, bot, templatesDir) {
      const p = ports(bot.display);
      const cfg = JSON.parse(readFileSync(join(templatesDir, "mcp.json"), "utf8")
        .replaceAll("{{NAME}}", bot.name).replaceAll("{{CDP_PORT}}", String(p.cdp)));
      // Connectors from Settings (ADR-0014) join the built-in servers; built-ins win on a key clash
      cfg.mcpServers = { ...claudeServers(bot), ...cfg.mcpServers };
      writeFileSync(join(dir, "mcp.json"), JSON.stringify(cfg, null, 2) + "\n");
    },
    needsTrustDir: true,
    loginProbe() {
      const r = spawnSync("claude", ["auth", "status"], { encoding: "utf8" });
      let ok = false;
      try { ok = JSON.parse(r.stdout).loggedIn === true; } catch { ok = r.status === 0 && /loggedIn"?: ?true/.test(r.stdout ?? ""); }
      return { ok, detail: ok ? "logged in" : "Login required: docker exec -it metor-box claude auth login" };
    },
    // Official OAuth login of the CLI: without a terminal it prints the sign-in link and waits for
    // the code the browser shows at the end – the UI passes that code to the waiting CLI.
    setup: {
      mode: "code",
      command: ["claude", "auth", "login"],
      hint: "Sign in with your Claude subscription. At the end the page shows a code – copy it and paste it here.",
    },
  },

  codex: {
    id: "codex",
    label: "Codex",
    kind: "ipc-host",
    adapterModule: "./metor-host-codex.mjs",
    // Fallback only – the live list comes from the app-server (`model/list`, no login needed, ~50 ms;
    // verified 2026-09-05), so new Codex models show up without a metor release
    models: [
      { id: "gpt-6-astra", label: "GPT-6 Astra", default: true },
      { id: "gpt-5.6-sol", label: "GPT-5.6 Sol" },
      { id: "gpt-5.6-terra", label: "GPT-5.6 Terra" },
      { id: "gpt-5.6-luna", label: "GPT-5.6 Luna" },
    ],
    listModels() {
      return new Promise((done) => {
        const child = spawn("codex", ["app-server"], { stdio: ["pipe", "pipe", "ignore"] });
        let id = 0, buf = ""; const waiting = new Map();
        const finish = (v) => { clearTimeout(timer); try { child.kill(); } catch {} done(v); };
        const timer = setTimeout(() => finish(null), 5000);
        const send = (method, params) => new Promise((r) => { const i = ++id; waiting.set(i, r); child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: i, method, params }) + "\n"); });
        child.on("error", () => finish(null));
        child.stdout.on("data", (d) => { buf += d; let i; while ((i = buf.indexOf("\n")) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); try { const m = JSON.parse(line); if (m.id != null && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); } } catch {} } });
        (async () => {
          await send("initialize", { clientInfo: { name: "metor", title: "metor", version: "1.0" } });
          child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "initialized", params: {} }) + "\n");
          const r = await send("model/list", {});
          const list = (r.result?.data ?? []).filter((m) => m?.id && !m.hidden).map((m) => ({ id: m.id, label: m.displayName ?? m.id, ...(m.isDefault ? { default: true } : {}) }));
          finish(list.length ? list : null);
        })().catch(() => finish(null));
      });
    },
    roleFile: "AGENTS.md",
    scaffold(dir, bot, templatesDir) {
      const tpl = readFileSync(join(templatesDir, "AGENTS.md"), "utf8")
        .replaceAll("{{NAME}}", bot.name).replaceAll("{{TITLE}}", bot.title ?? bot.name).replaceAll("{{ROLE}}", bot.role);
      writeFileSync(join(dir, "AGENTS.md"), tpl);
    },
    // MCP servers come per process via `-c mcp_servers…` overrides (spike S20, codex-facts.md)
    writeMcpConfig() {},
    needsTrustDir: false,
    loginProbe() {
      const r = spawnSync("codex", ["login", "status"], { encoding: "utf8" });
      return { ok: r.status === 0, detail: (r.stdout || r.stderr || "").trim().split("\n")[0] || "Login required" };
    },
    setup: {
      mode: "device",
      command: ["codex", "login", "--device-auth"],
      hint: "If the page reports that device-code authorization is disabled: enable it in the ChatGPT security settings (chatgpt.com → Settings → Security), then restart the setup.",
    },
  },
};

HARNESSES.gemini = {
  id: "gemini",
  label: "Gemini CLI",
  kind: "ipc-host",
  adapterModule: "./metor-host-gemini.mjs",
  // "default" = the CLI's own choice ("Auto": it picks per task); a full model id (Other model id…) pins one.
  // With a key, session/new over ACP lists the models (knowledge/harness/gemini-facts.md) – listModels()
  models: [{ id: "default", label: "Auto (Gemini decides)", default: true }],
  listModels() {
    const key = geminiKey(); if (!key) return Promise.resolve(null);
    return new Promise((done) => {
      const child = spawn("gemini", ["--acp", "--skip-trust"], { cwd: "/tmp", stdio: ["pipe", "pipe", "ignore"], env: { ...process.env, NO_BROWSER: "true", GEMINI_CLI_TRUST_WORKSPACE: "true", GEMINI_API_KEY: key } });
      let id = 0, buf = ""; const waiting = new Map();
      const finish = (v) => { clearTimeout(timer); try { child.kill(); } catch {} done(v); };
      const timer = setTimeout(() => finish(null), 8000);
      const send = (method, params) => new Promise((r) => { const i = ++id; waiting.set(i, r); child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: i, method, params }) + "\n"); });
      child.on("error", () => finish(null));
      child.stdout.on("data", (d) => { buf += d; let i; while ((i = buf.indexOf("\n")) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); try { const m = JSON.parse(line); if (m.id != null && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); } } catch {} } });
      (async () => {
        await send("initialize", { protocolVersion: 1, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } } });
        await send("authenticate", { methodId: "gemini-api-key" });
        const r = await send("session/new", { cwd: "/tmp", mcpServers: [] });
        const list = (r.result?.models?.availableModels ?? []).map((m) => (m.modelId === "auto"
          ? { id: "default", label: `Auto (Gemini decides${m.description ? `: ${m.description.replace(/^.*?:\s*/, "")}` : ""})`, default: true }
          : { id: m.modelId, label: m.name ?? m.modelId }));
        finish(list.length ? list : null);
      })().catch(() => finish(null));
    });
  },
  roleFile: "GEMINI.md",
  scaffold(dir, bot, templatesDir) {
    const tpl = readFileSync(join(templatesDir, "GEMINI.md"), "utf8")
      .replaceAll("{{NAME}}", bot.name).replaceAll("{{TITLE}}", bot.title ?? bot.name).replaceAll("{{ROLE}}", bot.role);
    writeFileSync(join(dir, "GEMINI.md"), tpl);
  },
  // Gemini CLI reads project settings from .gemini/settings.json in its cwd – the bot's directory
  writeMcpConfig(dir, bot) {
    const p = ports(bot.display);
    mkdirSync(join(dir, ".gemini"), { recursive: true });
    const builtIn = {
      browser: { command: "playwright-mcp", args: ["--cdp-endpoint", `http://127.0.0.1:${p.cdp}`, "--output-dir", `/workspace/bots/${bot.name}/.browser-output`, "--image-responses", "allow"], trust: true },
      routines: { command: "node", args: ["/usr/local/lib/metor/metor-routines-mcp.mjs", bot.name], trust: true },
    };
    writeFileSync(join(dir, ".gemini", "settings.json"), JSON.stringify({ mcpServers: { ...geminiServers(bot), ...builtIn } }, null, 2) + "\n");
  },
  needsTrustDir: false,
  loginProbe() {
    // Only a key counts: a Google login may leave oauth_creds.json behind although Google refuses
    // the CLI afterwards ("no longer supported for Gemini Code Assist for individuals", 2026-09-05)
    const key = geminiKey();
    return { ok: !!key, detail: key ? "API key stored" : "Needs a Gemini API key (New bot → Gemini CLI → Sign in)" };
  },
  // The assistant asks for a Gemini API key from Google AI Studio (free tier), keeps it inside the
  // box only (the runtime's .env, mode 600) and checks it with one small request before it counts.
  // Google's account login for the CLI stopped on 2026-09-05 ("This client is no longer supported
  // for Gemini Code Assist for individuals … migrate to the Antigravity suite") – facts file.
  setup: {
    mode: "key",
    keyLabel: "Gemini API key",
    link: "https://aistudio.google.com/apikey",
    hint: "Get a free key at Google AI Studio (the free tier needs no subscription – about 1,000 requests a day). The key stays inside the bots' computer.",
    // Only the shape: no spaces or control characters, a plausible length – Google decides the rest
    clean: (k) => String(k ?? "").trim().replace(/^GEMINI_API_KEY\s*=\s*/i, "").replace(/^["']|["']$/g, "").trim(),
    valid: (k) => /^[^\s\x00-\x1f\x7f]{16,400}$/.test(k),
    store(key) {
      mkdirSync(GEMINI_HOME, { recursive: true });
      let rest = ""; try { rest = readFileSync(join(GEMINI_HOME, ".env"), "utf8").split("\n").filter((l) => l && !/^GEMINI_API_KEY=/.test(l)).join("\n"); } catch {}
      writeFileSync(join(GEMINI_HOME, ".env"), `${rest ? rest + "\n" : ""}GEMINI_API_KEY=${key}\n`, { mode: 0o600 });
    },
    // One real request tells whether the key works (a bogus one answers "API key not valid")
    verify(key) {
      return new Promise((done) => {
        const child = spawn("gemini", ["-p", "Reply with the single word OK.", "--output-format", "json", "--skip-trust"], { cwd: "/tmp", stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, GEMINI_API_KEY: key, NO_BROWSER: "true", GEMINI_CLI_TRUST_WORKSPACE: "true" } });
        let out = "", err = ""; child.stdout.on("data", (d) => (out += d)); child.stderr.on("data", (d) => (err += d));
        const timer = setTimeout(() => { try { child.kill(); } catch {} }, 60_000);
        child.on("error", (e) => { clearTimeout(timer); done({ ok: false, error: e.message }); });
        child.on("close", () => {
          clearTimeout(timer);
          // The answer is JSON on stdout; an API failure lands as JSON (and a stack) on stderr
          let d = null; try { const i = out.indexOf("{"); if (i >= 0) d = JSON.parse(out.slice(i)); } catch {}
          const all = `${out}\n${err}`;
          if (d && !d.error) return done({ ok: true });
          if (/API key not valid|API_KEY_INVALID|INVALID_ARGUMENT|PERMISSION_DENIED/i.test(all)) return done({ ok: false, error: "Google did not accept this key" });
          if (/RESOURCE_EXHAUSTED|"code":\s*429/i.test(all)) return done({ ok: true });   // the key is fine, its quota is used up right now
          const line = err.split("\n").map((l) => l.trim()).filter((l) => l && !/^(Warning|\[STARTUP\]|at |\{|\})/.test(l)).pop();
          done({ ok: false, error: (d?.error?.message ?? line ?? "no answer from Gemini").slice(0, 200) });
        });
      });
    },
  },
};
// The runtime's home and the key it holds (the adapter hands it to the ACP process, the probe reports it)
const GEMINI_HOME = process.env.GEMINI_CLI_HOME ?? join(process.env.HOME ?? "/home/box", ".gemini");
export function geminiKey() {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY;
  try { return /^GEMINI_API_KEY=(\S+)/m.exec(readFileSync(join(GEMINI_HOME, ".env"), "utf8"))?.[1] ?? null; } catch { return null; }
}

// ---------- GitHub Copilot (ADR-0021; facts in knowledge/harness/copilot-facts.md) ----------
// The CLI's home: config.json with the login, session-store and session-state, logs – the volume metor-copilot
export const COPILOT_HOME = process.env.COPILOT_HOME ?? join(process.env.HOME ?? "/home/box", ".copilot");
const COPILOT_ENV = { ...process.env, COPILOT_AUTO_UPDATE: "false" };   // never let a probe replace the pinned CLI
// config.json is JSONC ("// User settings belong in settings.json." on top) – the comment lines go first
function copilotConfig() {
  try { return JSON.parse(readFileSync(join(COPILOT_HOME, "config.json"), "utf8").split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n")); } catch { return null; }
}
// "claude-fable-5.1" → "Claude Fable 5.1", "gpt-5.6-luna" → "GPT 5.6 Luna", "kimi-k2.7-code" → "Kimi K2.7 Code"
export const copilotLabel = (id) => String(id ?? "").split("-").filter(Boolean).map((w) => (/^(gpt|mai)$/i.test(w) || /^k\d/i.test(w) ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1))).join(" ");
HARNESSES.copilot = {
  id: "copilot",
  label: "GitHub Copilot",
  kind: "ipc-host",
  adapterModule: "./metor-host-copilot.mjs",
  // "auto" = the CLI's own choice per task; a full id (Other model id…) pins one – whether the CLI honours
  // it over ACP is verified only for the Free plan, where it did not (the label tells the truth either way)
  models: [{ id: "auto", label: "Auto (Copilot decides)", default: true }],
  // No model API without a session – `copilot help config` lists the ids the CLI accepts; cached per CLI
  // version in models.json, so a new CLI brings a new list without a metor release
  async listModels() {
    const db = readModelsFile(); const h = db.copilot ?? {};
    const cli = (spawnSync("copilot", ["--version"], { encoding: "utf8", timeout: 15_000, env: COPILOT_ENV }).stdout ?? "").match(/\d+\.\d+\.\d+/)?.[0] ?? "?";
    let ids = h.cli === cli && Array.isArray(h.ids) && h.ids.length ? h.ids : null;
    if (!ids) {
      const out = spawnSync("copilot", ["help", "config"], { encoding: "utf8", timeout: 20_000, env: COPILOT_ENV }).stdout ?? "";
      const section = out.split(/\n(?=\s*`)/).find((s) => /^\s*`model`:/.test(s)) ?? "";
      ids = [...section.matchAll(/^\s*-\s*"([^"]+)"/gm)].map((m) => m[1]);
      if (!ids.length) return null;
      db.copilot = { ...h, cli, ids }; writeModelsFile(db);
    }
    return [this.models[0], ...ids.map((id) => ({ id, label: copilotLabel(id) }))];
  },
  roleFile: "AGENTS.md",
  // The Codex template, with the browser server under the name Copilot allows (see writeMcpConfig)
  scaffold(dir, bot, templatesDir) {
    const tpl = readFileSync(join(templatesDir, "AGENTS.md"), "utf8")
      .replaceAll("{{NAME}}", bot.name).replaceAll("{{TITLE}}", bot.title ?? bot.name).replaceAll("{{ROLE}}", bot.role)
      .replace("MCP server `browser`, tools `browser_navigate`", "MCP server `playwright`, tools `playwright-browser_navigate`");
    writeFileSync(join(dir, "AGENTS.md"), tpl);
  },
  // The CLI ignores ACP's mcpServers parameter; a file on the command line (--additional-mcp-config @file)
  // augments its global ~/.copilot/mcp-config.json for that process only – written at every start
  writeMcpConfig(dir, bot) {
    const p = ports(bot.display);
    mkdirSync(join(dir, ".copilot"), { recursive: true });
    // Copilot's API reserves the namespace "browser" – a server of that name fails every turn with
    // "Function 'browser.browser-browser_click' is not allowed in reserved namespace" (2026-09-07), so
    // the bot's browser is the server "playwright" here (tools playwright-browser_navigate …)
    const builtIn = {
      playwright: { type: "local", command: "playwright-mcp", args: ["--cdp-endpoint", `http://127.0.0.1:${p.cdp}`, "--output-dir", `/workspace/bots/${bot.name}/.browser-output`, "--image-responses", "allow"], tools: ["*"] },
      routines: { type: "local", command: "node", args: ["/usr/local/lib/metor/metor-routines-mcp.mjs", bot.name], tools: ["*"] },
    };
    writeFileSync(join(dir, ".copilot", "mcp-config.json"), JSON.stringify({ mcpServers: { ...copilotServers(bot), ...builtIn } }, null, 2) + "\n");
  },
  needsTrustDir: false,
  // The CLI has no status command; its config.json names the login (the token itself is never read)
  loginProbe() {
    if (process.env.COPILOT_GITHUB_TOKEN || process.env.GH_TOKEN || process.env.GITHUB_TOKEN) return { ok: true, detail: "token from the environment" };
    const c = copilotConfig();
    const ok = !!(c?.authTokens && Object.keys(c.authTokens).length);
    const who = (c?.loggedInUsers ?? []).map((u) => u?.login).filter(Boolean).join(", ");
    return { ok, detail: ok ? `signed in${who ? ` as ${who}` : ""}` : "Sign in required (New bot → GitHub Copilot → Sign in)" };
  },
  // GitHub's device-code login, the shape of Codex's. Afterwards the CLI asks whether to keep the token in a
  // plaintext file (the box has no keychain) – only under a terminal, without one it drops the login: the
  // setup runner wraps the command in a pseudo-terminal (pty) and answers the question (answer)
  setup: {
    mode: "device",
    command: ["copilot", "login", "--device-code"],
    pty: true,
    answer: { when: /plaintext config file\?/i, text: "y" },
    hint: "Sign in with your GitHub account – any Copilot plan works, Free included. If a bot later answers \"Access denied by policy settings\", enable Copilot CLI and MCP servers in your Copilot settings (for members of an organisation its admin does that).",
  },
};

export const isIpcHarness = (id) => HARNESSES[id]?.kind === "ipc-host";
export const harnessOf = (b) => (typeof b === "string" ? b : b?.harness) ?? "claude-stream";
export const defaultModel = (id) => HARNESSES[id]?.models.find((m) => m.default)?.id ?? null;

// ---------- Model names: /workspace/.metor/models.json remembers what the runtimes resolve and use ----------
const STATE_DIR = process.env.METOR_AUTH_DIR ?? join(process.env.METOR_WORKSPACE_DIR ?? "/workspace", ".metor");
const MODELS_FILE = join(STATE_DIR, "models.json");
const readModelsFile = () => { try { return JSON.parse(readFileSync(MODELS_FILE, "utf8")); } catch { return {}; } };
function writeModelsFile(db) { mkdirSync(STATE_DIR, { recursive: true }); const tmp = `${MODELS_FILE}.${process.pid}.tmp`; writeFileSync(tmp, JSON.stringify(db, null, 2) + "\n"); renameSync(tmp, MODELS_FILE); }
const modelsFileStamp = () => { try { return statSync(MODELS_FILE).mtimeMs; } catch { return 0; } };
// "claude-fable-5-1" → "Fable 5.1", "claude-haiku-4-5-20251001" → "Haiku 4.5", "claude-opus-5[1m]" → "Opus 5",
// "gemini-3.5-flash" → "Gemini 3.5 Flash", "gemini-3.1-pro-preview" → "Gemini 3.1 Pro Preview"
export function prettyModel(id) {
  const m = /^claude-([a-z]+)-(\d+(?:-\d+)*?)(?:-\d{8})?(?:\[1m\])?$/.exec(String(id ?? ""));
  if (m) return `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2].replace(/-/g, ".")}`;
  const g = /^gemini-(\d+(?:\.\d+)?)-([a-z]+(?:-[a-z]+)*?)(?:-customtools)?$/.exec(String(id ?? ""));
  return g ? `Gemini ${g[1]} ${g[2].split("-").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ")}` : null;
}
// The CLI's model picker, through the SDK (no message is sent): alias family → "Family version"
async function pickerVersions() {
  const { query } = await import("@anthropic-ai/claude-agent-sdk");
  async function* none() {}
  const q = query({ prompt: none(), options: { cwd: "/tmp", maxTurns: 1 } });
  const list = await Promise.race([q.supportedModels(), new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 8000))]);
  try { q.close?.(); } catch {}
  const out = {};
  for (const m of list ?? []) {
    const family = ["fable", "opus", "sonnet", "haiku"].find((f) => String(m.value ?? "").includes(f));
    if (!family || out[family]) continue;
    const label = prettyModel(m.value) ?? String(m.description ?? "").split(" · ")[0].replace(/ with .*$/, "").trim();
    if (/^[A-Z][a-z]+ \d/.test(label)) out[family] = label;
  }
  return Object.keys(out).length ? out : null;
}
// A bot's answer reports which model actually ran (SDK result.modelUsage) – the truth behind an alias
export function recordSeenModel(harness, alias, usageIds, chosen = null) {
  if (!alias || !usageIds?.length) return;
  const id = chosen ?? usageIds.find((u) => u.includes(alias)) ?? null;   // "fable" → "claude-fable-5-1"; an explicit id matches itself
  if (!id || id === alias) return;
  const db = readModelsFile(); const h = (db[harness] ??= {}); const seen = (h.seen ??= {});
  if (seen[alias]?.id === id) return;
  seen[alias] = { id, at: new Date().toISOString() }; writeModelsFile(db);
}

// ---------- Models: the live list where the runtime offers one, else the registry's own ----------
// Cached for ten minutes per runtime; a failed query falls back to the static list. The gateway asks
// here for the create dialog and for labels; the CLI and the gateway validate with validModel().
const modelCache = new Map();   // harness id → { at, stamp, list }
export async function modelsFor(id) {
  const h = HARNESSES[id]; if (!h) return [];
  const c = modelCache.get(id);
  if (c && Date.now() - c.at < 10 * 60_000 && c.stamp === modelsFileStamp()) return c.list;   // a bot's answer may have taught a new name
  let list = null;
  if (h.listModels) { try { list = await h.listModels(); } catch {} }
  list = list ?? h.models;
  modelCache.set(id, { at: Date.now(), stamp: modelsFileStamp(), list });
  return list;
}
export function modelLabel(id, model) {
  const listed = (modelCache.get(id)?.list ?? HARNESSES[id]?.models ?? []).find((m) => m.id === model)?.label ?? HARNESSES[id]?.models.find((m) => m.id === model)?.label ?? null;
  if (id === "gemini" && model === "default") {   // "Auto" – say which model answered last
    const seen = readModelsFile().gemini?.seen?.default?.id; const p = seen && prettyModel(seen);
    return p ? `Auto · ${p}` : "Auto";
  }
  if (id === "copilot") {   // "Auto" – the model that answered last; a pin the CLI did not honour reads as Auto too
    const seen = readModelsFile().copilot?.seen?.[model]?.id;
    if (seen && seen !== model) return `Auto · ${copilotLabel(seen)}`;
    return model === "auto" ? "Auto" : (listed ?? copilotLabel(model));
  }
  return listed ?? prettyModel(model);
}
// Known to the registry or the live list – or an explicit id the runtime may know (a new model,
// a full id such as claude-fable-5-1): shape-checked here, the runtime says no if it does not exist
const MODEL_ID = /^[A-Za-z0-9][\w.:[\]-]{0,63}$/;
export const validModel = (id, model) => !!HARNESSES[id] && (HARNESSES[id].models.some((m) => m.id === model) || !!modelCache.get(id)?.list.some((m) => m.id === model) || MODEL_ID.test(String(model)));
