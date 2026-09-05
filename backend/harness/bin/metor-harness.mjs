// metor-harness – the harness registry (ADR-0011): the single source of knowledge about which
// runtimes exist, which models they run, how a bot directory is laid out and
// how login/setup work. UI term "Runtime", the code term stays `harness` (GLOSSARY).
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { claudeServers } from "./metor-connectors.mjs";

// Port scheme per display – shared by metor.mjs and the adapters
export const ports = (d) => ({ display: d, vnc: 5900 + d, novnc: 6000 + d, cdp: 9200 + d, ttyd: 7100 + d });

export const HARNESSES = {
  "claude-stream": {
    id: "claude-stream",
    label: "Claude Code",
    kind: "ipc-host",                      // seam: future runtimes may be kind "http" (OpenCode)
    adapterModule: "./metor-host-claude.mjs",
    // Aliases: Claude Code resolves each to the newest model of that family, so the list stays
    // current with the CLI (verified 2026-09-05: `fable` → claude-fable-5-1 with a subscription)
    models: [
      { id: "fable", label: "Fable" },
      { id: "opus", label: "Opus" },
      { id: "sonnet", label: "Sonnet", default: true },
      { id: "haiku", label: "Haiku" },
    ],
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
      { id: "gpt-5.6-sol", label: "GPT-5.6 Sol", default: true },
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

export const isIpcHarness = (id) => HARNESSES[id]?.kind === "ipc-host";
export const harnessOf = (b) => (typeof b === "string" ? b : b?.harness) ?? "claude-stream";
export const defaultModel = (id) => HARNESSES[id]?.models.find((m) => m.default)?.id ?? null;

// ---------- Models: the live list where the runtime offers one, else the registry's own ----------
// Cached for ten minutes per runtime; a failed query falls back to the static list. The gateway asks
// here for the create dialog and for labels; the CLI and the gateway validate with validModel().
const modelCache = new Map();   // harness id → { at, list }
export async function modelsFor(id) {
  const h = HARNESSES[id]; if (!h) return [];
  const c = modelCache.get(id);
  if (c && Date.now() - c.at < 10 * 60_000) return c.list;
  let list = null;
  if (h.listModels) { try { list = await h.listModels(); } catch {} }
  list = list ?? h.models;
  modelCache.set(id, { at: Date.now(), list });
  return list;
}
export const modelLabel = (id, model) => (modelCache.get(id)?.list ?? HARNESSES[id]?.models ?? []).find((m) => m.id === model)?.label ?? HARNESSES[id]?.models.find((m) => m.id === model)?.label ?? null;
// Known to the registry or the live list – or an explicit id the runtime may know (a new model,
// a full id such as claude-fable-5-1): shape-checked here, the runtime says no if it does not exist
const MODEL_ID = /^[A-Za-z0-9][\w.:[\]-]{0,63}$/;
export const validModel = (id, model) => !!HARNESSES[id] && (HARNESSES[id].models.some((m) => m.id === model) || !!modelCache.get(id)?.list.some((m) => m.id === model) || MODEL_ID.test(String(model)));
