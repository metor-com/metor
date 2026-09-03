// metor-lifecycle – a bot's life: create (scaffold from the runtime's template), start (desktop chain
// + host process metor-agent-host, ADR-0009/0011), stop, remove. The host's state lives in
// <bot>/.metor/harness.json (sessionId, status, pid), its PID in <bot>/.metor/host.pid.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { HARNESSES, harnessOf, defaultModel, validModel } from "./metor-harness.mjs";
import { TEMPLATES, botDir, writeBot } from "./metor-store.mjs";
import { desktopAlive, desktopCoreDead, desktopStart, desktopStop, isProcess, pidAlive, waitFor, watchUrl } from "./metor-desktop.mjs";

const HOST_SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "metor-agent-host.mjs");

// ---------- Host process ----------
export const hostPidFile = (b) => join(botDir(b.name), ".metor", "host.pid");
// All hosts share the pattern "metor-agent-host" – after a container restart a reused PID may point
// to the host of ANOTHER bot. The command line must name this bot, and the PID must be a process.
export function hostPidMatches(b, n) {
  try {
    if (!isProcess(n)) return false;
    const argv = readFileSync(`/proc/${n}/cmdline`, "utf8").split("\0");
    return argv.some((a) => a.includes("metor-agent-host")) && argv.includes(b.name);
  } catch { return false; }
}
export function hostAlive(b) {
  try { const n = Number(readFileSync(hostPidFile(b), "utf8").trim()); return hostPidMatches(b, n) ? n : null; } catch { return null; }
}
export function harnessState(b) { try { return JSON.parse(readFileSync(join(botDir(b.name), ".metor", "harness.json"), "utf8")); } catch { return {}; } }
// Accept the trust dialog non-interactively (otherwise Claude Code ignores the bot's .claude/settings.json)
function trustDir(dir) {
  const cfg = join(process.env.CLAUDE_CONFIG_DIR ?? join(process.env.HOME, ".claude"), ".claude.json");
  let json = {}; try { json = JSON.parse(readFileSync(cfg, "utf8")); } catch {}
  json.projects ??= {}; json.projects[dir] ??= {};
  if (json.projects[dir].hasTrustDialogAccepted === true) return;
  json.projects[dir].hasTrustDialogAccepted = true;
  writeFileSync(cfg, JSON.stringify(json, null, 2) + "\n", { mode: 0o600 });
}

// ---------- Create / start / stop / remove ----------
export function createAgent({ name, role = "General assistant for the user.", harness = "claude-stream", model, permissionMode = "acceptEdits" }) {
  const dir = botDir(name); if (existsSync(join(dir, "bot.json"))) throw new Error(`Bot ${name} already exists`);
  const desc = HARNESSES[harness];
  if (!desc) throw new Error(`unknown harness: ${harness} (available: ${Object.keys(HARNESSES).join(", ")})`);
  model ??= defaultModel(harness);
  if (model && !validModel(harness, model)) throw new Error(`unknown model "${model}" for ${desc.label} (available: ${desc.models.map((m) => m.id).join(", ")})`);
  mkdirSync(dir, { recursive: true });
  desc.scaffold(dir, { name, role }, TEMPLATES);
  const bot = { name, role, harness, ...(model ? { model } : {}), permissionMode, autostart: true, sessionId: null, createdAt: new Date().toISOString() };
  writeBot(bot);
  return bot;
}
// Start: desktop chain + host process; idempotent (a running host only gets its desktop repaired)
export function startAgent(b) {
  if (!HARNESSES[harnessOf(b)]) throw new Error(`${b.name}: unknown runtime "${harnessOf(b)}" – not started`);
  if (hostAlive(b)) {
    if (desktopAlive(b)) return console.log(`${b.name}: already running`);
    console.log(`${b.name}: host running, restarting desktop`);
    if (desktopCoreDead(b)) desktopStop(b);
    desktopStart(b);
    return;
  }
  const dir = join(botDir(b.name), ".metor"); mkdirSync(dir, { recursive: true });
  // Start lock: CLI start and supervisor tick must not spawn at the same time (otherwise two hosts
  // processing the same inbox twice – observed 2026-08-31)
  const lock = join(dir, "start.lock");
  try { const l = JSON.parse(readFileSync(lock, "utf8")); if (Date.now() - l.t < 60_000 && pidAlive(l.pid)) return console.log(`${b.name}: start already in progress`); } catch {}
  writeFileSync(lock, JSON.stringify({ pid: process.pid, t: Date.now() }));
  try {
    trustDir(botDir(b.name));
    if (b.autostart !== true) { b.autostart = true; writeBot(b); } // started means "running and stays running"
    desktopStart(b);
    const log = openSync(join(dir, "host.log"), "a");
    const child = spawn("node", [HOST_SCRIPT, b.name], { cwd: botDir(b.name), detached: true, stdio: ["ignore", log, log], env: process.env });
    child.on("error", (e) => console.error(`${b.name}: host start failed: ${e.message}`));
    child.unref(); writeFileSync(join(dir, "host.pid"), String(child.pid));
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) { const s = harnessState(b); if (s.pid === child.pid && s.status && s.status !== "starting") break; spawnSync("sleep", ["1"]); }
    const s = harnessState(b);
    // The child exits at once if its own guard finds a host for this bot already running (observed
    // 2026-09-02): adopt that host, otherwise host.pid points at the loser and the bot reads as
    // "stopped" although it answers.
    if (s.pid && s.pid !== child.pid && !pidAlive(child.pid) && hostPidMatches(b, s.pid)) writeFileSync(join(dir, "host.pid"), String(s.pid));
    console.log(`${b.name}: running (stream, session ${s.sessionId ?? "new"}, display :${b.display})\n  watch: ${watchUrl(b)}`);
  } finally { rmSync(lock, { force: true }); }
}
export function stopHost(b) {
  const pid = hostAlive(b);
  if (!pid) return false;
  try { process.kill(pid, "SIGTERM"); } catch {}
  const gone = () => { try { process.kill(pid, 0); return false; } catch { return true; } };
  waitFor(gone, 8_000);
  if (!gone()) { try { process.kill(pid, "SIGKILL"); } catch {} }
  rmSync(hostPidFile(b), { force: true });
  return true;
}
// autostart off first, otherwise the supervisor tick restarts the bot within 30 s ("stop" wouldn't stick)
export function stopAgent(b) {
  b.autostart = false; writeBot(b);
  const wasRunning = stopHost(b);
  desktopStop(b);
  return wasRunning;
}
export function removeAgent(b, { keepFiles = false } = {}) {
  // Switch autostart off and save before anything else: otherwise the supervisor tick revives the
  // bot in the middle of removal (session gone → tick restarts → directory is created anew).
  stopAgent(b);
  if (!keepFiles) rmSync(botDir(b.name), { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
}
