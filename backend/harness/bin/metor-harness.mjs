// metor-harness – the harness registry (ADR-0011): the single source of knowledge about which
// runtimes exist, which models they run, how a bot directory is laid out and
// how login/setup work. UI term "Runtime", the code term stays `harness` (GLOSSARY).
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Port scheme per display – shared by metor.mjs and the adapters
export const ports = (d) => ({ display: d, vnc: 5900 + d, novnc: 6000 + d, cdp: 9200 + d, ttyd: 7100 + d });

export const HARNESSES = {
  "claude-stream": {
    id: "claude-stream",
    label: "Claude Code",
    kind: "ipc-host",                      // seam: future runtimes may be kind "http" (OpenCode)
    adapterModule: "./metor-host-claude.mjs",
    models: [
      { id: "opus", label: "Opus" },
      { id: "sonnet", label: "Sonnet", default: true },
      { id: "haiku", label: "Haiku" },
    ],
    roleFile: "CLAUDE.md",
    scaffold(dir, bot, templatesDir) {
      mkdirSync(join(dir, ".claude"), { recursive: true });
      const tpl = readFileSync(join(templatesDir, "CLAUDE.md"), "utf8")
        .replaceAll("{{NAME}}", bot.name).replaceAll("{{ROLE}}", bot.role);
      writeFileSync(join(dir, "CLAUDE.md"), tpl);
      writeFileSync(join(dir, ".claude", "settings.json"), readFileSync(join(templatesDir, "settings.json"), "utf8"));
    },
    writeMcpConfig(dir, bot, templatesDir) {
      const p = ports(bot.display);
      writeFileSync(join(dir, "mcp.json"), readFileSync(join(templatesDir, "mcp.json"), "utf8")
        .replaceAll("{{NAME}}", bot.name).replaceAll("{{CDP_PORT}}", String(p.cdp)));
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
    models: [
      { id: "gpt-5.6-sol", label: "GPT-5.6 Sol", default: true },
      { id: "gpt-5.6-terra", label: "GPT-5.6 Terra" },
      { id: "gpt-5.6-luna", label: "GPT-5.6 Luna" },
    ],
    roleFile: "AGENTS.md",
    scaffold(dir, bot, templatesDir) {
      const tpl = readFileSync(join(templatesDir, "AGENTS.md"), "utf8")
        .replaceAll("{{NAME}}", bot.name).replaceAll("{{ROLE}}", bot.role);
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
export const validModel = (id, model) => !!HARNESSES[id]?.models.some((m) => m.id === model);
