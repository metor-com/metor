#!/usr/bin/env node
// metor – the CLI inside the computer: bot create|list|start|stop|logs|watch|rm and the supervisor
// entrypoint. The host side (box build|up|down|…, Docker) is the Bash wrapper `metor` next to
// this file, which forwards `bot …` into the container. Logic lives in metor-store.mjs (bot.json),
// metor-desktop.mjs (desktop chain), metor-lifecycle.mjs (create/start/stop/rm), metor-supervise.mjs.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { HARNESSES, harnessOf } from "./metor-harness.mjs";
import { allBots, botDir, readBot, idFor } from "./metor-store.mjs";
import { desktopAlive, ensureDesktopConfig, watchUrl } from "./metor-desktop.mjs";
import { createAgent, harnessState, hostAlive, removeAgent, startAgent, stopAgent } from "./metor-lifecycle.mjs";
import { supervise } from "./metor-supervise.mjs";
import { createClaim, listSessions, revokeSession, qrTerminal } from "./metor-auth.mjs";

const INSIDE = process.env.METOR_INSIDE_BOX === "1";
const die = (msg) => { console.error(`metor: ${msg}`); process.exit(1); };
const arg = (flags, name, dflt) => { const i = flags.indexOf(`--${name}`); return i >= 0 ? flags[i + 1] : dflt; };
const has = (flags, name) => flags.includes(`--${name}`);

const bot = {
  create(flags) {
    const title = flags[0]; if (!title) die("metor bot create <name> [--id <id>] --role \"...\" [--harness <id>] [--model <id>]");
    const name = arg(flags, "id") ?? idFor(title);   // the name is free text, the id follows the directory rules
    const b = createAgent({ name, title, role: arg(flags, "role"), harness: arg(flags, "harness"), model: arg(flags, "model"), permissionMode: arg(flags, "mode") });
    console.log(`Bot "${b.title}" created as ${name} in ${botDir(name)} (${HARNESSES[harnessOf(b)].label}${b.model ? ` · ${b.model}` : ""})`);
    if (!has(flags, "no-start")) startAgent(b);
  },
  list() {
    const rows = allBots().map((b) => {
      const st = hostAlive(b) ? (harnessState(b).status ?? "idle") : "stopped";
      const session = harnessState(b).sessionId ?? "-";
      return `${b.name.padEnd(20)} ${st.padEnd(10)} ${(b.display ? `:${b.display}${desktopAlive(b) ? "" : "!"}` : "-").padEnd(8)} ${harnessOf(b).padEnd(13)} ${(b.model ?? "-").padEnd(14)} ${session}`;
    });
    console.log(rows.length ? `${"NAME".padEnd(20)} ${"STATUS".padEnd(10)} ${"DISPLAY".padEnd(8)} ${"HARNESS".padEnd(13)} ${"MODEL".padEnd(14)} SESSION\n${rows.join("\n")}` : "no bots");
  },
  start(flags) {
    const targets = has(flags, "all") ? allBots().filter((b) => b.autostart) : [readBot(flags[0] ?? die("metor bot start <name>|--all"))];
    for (const b of targets) { try { startAgent(b); } catch (e) { console.error(`metor: ${e.message}`); } }
  },
  stop(flags) {
    const b = readBot(flags[0] ?? die("metor bot stop <name>"));
    console.log(stopAgent(b) ? `${b.name}: host stopped` : `${b.name}: not running`);
  },
  watch(flags) { const b = readBot(flags[0] ?? die("metor bot watch <name>")); ensureDesktopConfig(b); console.log(watchUrl(b)); },
  logs(flags) {
    const b = readBot(flags[0] ?? die("metor bot logs <name>"));
    spawnSync("tail", ["-50", join(botDir(b.name), ".metor", "host.log")], { stdio: "inherit" });
  },
  rm(flags) {
    const b = readBot(flags[0] ?? die("metor bot rm <name>"));
    removeAgent(b, { keepFiles: has(flags, "keep-files") });
    console.log(`Bot ${b.name} removed${has(flags, "keep-files") ? " (files kept)" : ""}`);
  },
};

// Sign-in without passwords (ADR-0012): setup link for the first device, device list, revoke
const auth = {
  async link(flags) {
    const c = createClaim("setup");
    console.log(`Sign-in link (valid 24 hours, single use):\n\n  ${c.url}\n`);
    if (!has(flags, "plain")) { try { console.log(await qrTerminal(c.url)); } catch {} }
  },
  sessions() {
    const rows = listSessions();
    console.log(rows.length ? rows.map((s) => `${s.id}  ${s.name.padEnd(22)} last seen ${new Date(s.lastSeenAt).toISOString()}  via ${s.via}`).join("\n") : "no devices signed in");
  },
  revoke(flags) { const id = flags[0] ?? die("metor auth revoke <id>"); console.log(revokeSession(id) ? `session ${id} revoked` : `no session ${id}`); },
};

// Version: VERSION file next to this script in the image, repo root in a checkout
const VERSION = (() => {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const p of [join(here, "VERSION"), join(here, "..", "..", "..", "VERSION")]) {
    try { return readFileSync(p, "utf8").trim(); } catch {}
  }
  return "dev";
})();
const usage = `metor – CLI (inside the computer; on the host use the metor shell wrapper)
  bot  create <name> [--id <id>] --role "..." [--harness claude-stream|codex] [--model <id>] [--mode acceptEdits] [--no-start]
       (the name is free text; the id – directory, API path, address between bots – is derived from it: "Mein Bot!" -> mein-bot)
       list | start <name>|--all | stop <name> | logs <name> | watch <name> | rm <name> [--keep-files]
  auth link [--plain] | sessions | revoke <id>       (sign-in link for a device, signed-in devices)
  supervise                                          (entrypoint, PID 1)`;
const [cmd, sub, ...rest] = process.argv.slice(2);
if (cmd === "--version" || cmd === "version") { console.log(`metor ${VERSION}`); process.exit(0); }
if (cmd === "supervise") { if (!INSIDE) die("supervise only runs inside the computer"); supervise(); }
else if (cmd === "bot" || cmd === "auth") {
  const fn = (cmd === "bot" ? bot : auth)[sub] ?? (() => die(usage));
  try { await fn(rest); } catch (e) { die(e.message); }
} else if (cmd === "box") die("box commands run on the host through the metor shell wrapper (backend/harness/bin/metor)");
else { console.log(usage); process.exit(cmd ? 1 : 0); }
