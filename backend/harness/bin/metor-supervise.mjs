// metor-supervise – PID 1 inside the computer: starts the gateway, brings every autostart bot up
// (desktop chain + host process) and keeps both alive, fires due routines (ADR-0010), rotates the
// bus log. One tick every 30 s; login gate per runtime (ADR-0011).
import { spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { injectTurn } from "./metor-chat-stream.mjs";
import { dueRoutines, recordRun } from "./metor-routines.mjs";
import { HARNESSES, harnessOf } from "./metor-harness.mjs";
import { BOTS_DIR, TEMPLATES, allBots, botDir, writeBot } from "./metor-store.mjs";
import { desktopAlive, desktopCoreDead, desktopForgetPids, desktopStart, desktopStop } from "./metor-desktop.mjs";
import { hostAlive, hostPidFile, startAgent, stopHost } from "./metor-lifecycle.mjs";
import { AUTH_OFF, createClaim, hasOpenClaim, hasSessions } from "./metor-auth.mjs";

const GATEWAY_SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "metor-gateway.mjs");

// Global Codex base configuration (credentials-store file, sandbox off – the box is the boundary);
// created once, login data (auth.json) stays untouched in the metor-codex volume
function ensureCodexConfig() {
  const home = join(process.env.HOME ?? "/home/box", ".codex");
  try {
    mkdirSync(home, { recursive: true });
    const cfg = join(home, "config.toml");
    if (!existsSync(cfg)) writeFileSync(cfg, readFileSync(join(TEMPLATES, "codex-config.toml"), "utf8"));
  } catch (e) { console.error("ensureCodexConfig:", e.message); }
}

export function supervise() {
  mkdirSync(BOTS_DIR, { recursive: true });
  ensureCodexConfig();
  // First boot without any signed-in device: print a setup link (ADR-0012) – `metor auth link` makes a new one
  if (!AUTH_OFF && !hasSessions() && !hasOpenClaim("setup")) {
    try { const c = createClaim("setup"); console.log(`supervise: no device signed in yet – open this link once (valid 24 h; later: metor auth link):\n  ${c.url}`); } catch (e) { console.error("auth:", e.message); }
  }
  // Fresh container: no desktop/host processes – old PID files are corpses, and so is the PID in
  // harness.json (the host's double-start guard must not trip over it)
  for (const b of allBots()) {
    desktopForgetPids(b);
    rmSync(hostPidFile(b), { force: true });
    const hs = join(botDir(b.name), ".metor", "harness.json");
    try { const s = JSON.parse(readFileSync(hs, "utf8")); if (s.pid) writeFileSync(hs, JSON.stringify({ ...s, pid: null, status: "stopped" }) + "\n"); } catch {}
  }
  // One-time: bots created before titles existed get `title` written into bot.json (readBot fills
  // it in memory; this makes the file self-describing for the CLI, backups and hand edits)
  for (const b of allBots()) {
    try {
      if (JSON.parse(readFileSync(join(botDir(b.name), "bot.json"), "utf8")).title != null) continue;
      const { name, title, ...rest } = b;
      writeBot({ name, title, ...rest });
      console.log(`supervise: ${name}: title "${title}" added to bot.json`);
    } catch {}
  }
  // Login gate PER harness (ADR-0011): every runtime has its own login; a missing
  // Codex login must not block Claude bots and vice versa. Non-ok probes are retried every tick.
  const loginOk = {};
  const probeHarness = (id) => {
    if (loginOk[id]) return true;
    const desc = HARNESSES[id];
    if (!desc) return false;
    const probe = desc.loginProbe();
    if (probe.ok && !loginOk[id]) console.log(`supervise: ${desc.label} logged in`);
    loginOk[id] = probe.ok;
    if (!probe.ok) console.log(`supervise: ${desc.label} NOT logged in – ${probe.detail}`);
    return probe.ok;
  };
  for (const id of new Set(allBots().map((b) => harnessOf(b)))) probeHarness(id);
  let gateway = null;
  // Caution: on death by signal (e.g. SIGTERM) exitCode stays null – signalCode carries the value.
  // Only both together mean "still alive"; otherwise the supervisor would never respawn a killed gateway.
  const ensureGateway = () => { if (gateway && gateway.exitCode == null && gateway.signalCode == null) return; gateway = spawn("node", [GATEWAY_SCRIPT], { stdio: "inherit", env: process.env }); };
  ensureGateway();
  let stopping = false;
  const tick = () => {
    ensureGateway();
    if (stopping) return;
    const bots = allBots().filter((b) => b.autostart);
    for (const b of bots) if (hostAlive(b) && !desktopAlive(b)) {
      const core = desktopCoreDead(b);
      console.log(`supervise: ${core ? "restarting" : "completing (terminal/dock)"} desktop of ${b.name}`);
      try { if (core) desktopStop(b); desktopStart(b); } catch (e) { console.error(e); }
    }
    for (const b of bots) if (!hostAlive(b)) {
      if (!probeHarness(harnessOf(b))) continue;   // runtime not logged in (or unknown) → only these bots wait
      console.log(`supervise: starting ${b.name}`); try { startAgent(b); } catch (e) { console.error(e); }
    }
    // Bus log rotation: keep one generation; the readers' tail cursors detect the
    // truncation (size < offset → reset) by themselves
    try {
      const bus = join(process.env.METOR_BUS_DIR ?? "/workspace/bus", "messages.jsonl");
      if (existsSync(bus) && statSync(bus).size > 10 * 1024 * 1024) { renameSync(bus, `${bus}.1`); console.log("supervise: bus log rotated"); }
    } catch (e) { console.error(e); }
    // Routines (ADR-0010): due schedules as a turn into the inbox – only if the host is alive,
    // otherwise nextRunAt stays in the past and the run is caught up on boot.
    for (const b of bots) if (hostAlive(b)) {
      try {
        const { due, paused } = dueRoutines(BOTS_DIR, b.name);
        for (const r of due) {
          console.log(`supervise: routine "${r.name}" (${r.id}) for ${b.name}`);
          injectTurn(BOTS_DIR, b.name, `[Routine "${r.name}"] ${r.prompt}`, { origin: "routine" });
          recordRun(BOTS_DIR, b.name, r);
        }
        // The auto-pause has struck: notice directly into the history (NO turn – that would cost exactly
        // the quota the guard protects); the bot switches it back on when asked via update_task
        for (const r of paused) {
          console.log(`supervise: routine "${r.name}" (${r.id}) for ${b.name} paused – ${r.pausedReason}`);
          appendFileSync(join(BOTS_DIR, b.name, ".metor", "chat.jsonl"), JSON.stringify({
            v: 2, id: randomUUID(), ts: new Date().toISOString(), role: "assistant", kind: "text",
            text: `⏸️ The routine "${r.name}" was paused automatically: ${r.pausedReason}. If it should keep running, just let me know – I'll switch it back on.`,
          }) + "\n");
        }
      } catch (e) { console.error(e); }
    }
  };
  tick(); const timer = setInterval(tick, 30_000);
  // The gateway goes first: otherwise it would watch the bots stop and send "stopped" push notifications on every restart
  const shutdown = () => { stopping = true; clearInterval(timer); try { gateway?.kill("SIGTERM"); } catch {} console.log("supervise: stopping bots"); for (const b of allBots()) stopHost(b); for (const b of allBots()) desktopStop(b); process.exit(0); };
  process.on("SIGTERM", shutdown); process.on("SIGINT", shutdown);
}
