// metor-desktop – the desktop chain per bot: Xtigervnc → openbox → tint2 → Chromium (CDP) →
// websockify/noVNC → ttyd (terminal tab) → xterm. One X display per bot, ports derived from it
// (metor-harness.mjs `ports`); PID files under <bot>/.desktop/, idempotent start.
import { spawn, spawnSync } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { HARNESSES, harnessOf, ports } from "./metor-harness.mjs";
import { TEMPLATES, allBots, botDir, readBot, writeBot } from "./metor-store.mjs";

const WATCH_BASE = (process.env.METOR_WATCH_BASE ?? "").replace(/\/$/, "");
const DISPLAY_MIN = 11, DISPLAY_MAX = 49;

// ---------- Processes ----------
export function pidAlive(pid) { try { process.kill(pid, 0); return true; } catch { return false; } }
// Alive AND a process (thread group leader): kill(tid, 0) also succeeds for thread IDs and
// /proc/<tid>/cmdline shows the owning process – a stale PID from the previous container matched
// a thread of the freshly started host itself (2026-09-02)
export function isProcess(pid) {
  if (!Number.isInteger(pid) || !pidAlive(pid)) return false;
  try { return new RegExp(`^Tgid:\\s+${pid}$`, "m").test(readFileSync(`/proc/${pid}/status`, "utf8")); } catch { return false; }
}
const PROC_MATCH = { xvfb: "Xvfb", openbox: "openbox", chromium: "chromium", xterm: "xterm", tint2: "tint2", x11vnc: "x11vnc", novnc: "websockify", ttyd: "ttyd", host: "metor-agent-host" };
// A PID file only counts if the process is alive AND has the expected command line (PID reuse after container restart)
function readPid(file) {
  try {
    const n = Number(readFileSync(file, "utf8").trim()); if (!isProcess(n)) return null;
    const key = Object.keys(PROC_MATCH).find((k) => file.endsWith(`/${k}.pid`));
    if (key) { let cmd = ""; try { cmd = readFileSync(`/proc/${n}/cmdline`, "utf8"); } catch { return null; } if (!(key === "xvfb" ? /Xvfb|Xtigervnc/.test(cmd) : cmd.includes(PROC_MATCH[key]))) return null; }
    return n;
  } catch { return null; }
}
export function waitFor(test, ms) { const deadline = Date.now() + ms; while (Date.now() < deadline) { if (test()) return true; spawnSync("sleep", ["0.5"]); } return test(); }

// ---------- Display, watch link, per-bot config ----------
function freeDisplay() {
  const used = new Set(allBots().map((b) => b.display).filter(Boolean));
  for (let d = DISPLAY_MIN; d <= DISPLAY_MAX; d += 1) if (!used.has(d)) return d;
  throw new Error("no free displays");
}
// The watch link goes through the gateway (/bots/<name>/…): public behind Caddy+login under METOR_WATCH_BASE
// (e.g. https://bots.example.com), locally http://127.0.0.1:6010. The token in the link is the second factor.
// path= forces noVNC onto the gateway path; without it, it connects to ws://…/websockify at the root (no bot there).
export function watchUrl(b) { return `${WATCH_BASE || "http://127.0.0.1:6010"}/bots/${b.name}/vnc.html?autoconnect=1&resize=scale&path=bots/${b.name}/websockify&password=${b.watchToken}`; }
export function ensureDesktopConfig(b) {
  let changed = false;
  if (!b.display) { b.display = freeDisplay(); changed = true; }
  if (!b.watchToken) { b.watchToken = randomBytes(16).toString("hex"); changed = true; }   // 128 bit: VNC password + watch cookie
  if (changed) writeBot(b);
  const dir = botDir(b.name); mkdirSync(join(dir, ".metor"), { recursive: true }); mkdirSync(join(dir, ".desktop"), { recursive: true });
  writeFileSync(join(dir, ".metor", "watch-url"), watchUrl(b) + "\n");
  HARNESSES[harnessOf(b)]?.writeMcpConfig(dir, b, TEMPLATES);
}

// ---------- Chain ----------
function launch(b, key, cmd, args, extraEnv = {}) {
  const dir = join(botDir(b.name), ".desktop"), pidFile = join(dir, `${key}.pid`);
  if (readPid(pidFile)) return false;
  const log = openSync(join(dir, `${key}.log`), "a");
  const child = spawn(cmd, args, { cwd: botDir(b.name), detached: true, stdio: ["ignore", log, log], env: { ...process.env, DISPLAY: `:${b.display}`, ...extraEnv } });
  // Without a handler a spawn error (e.g. binary missing from the image) takes down the whole process – in the supervisor that would be PID 1
  child.on("error", (e) => console.error(`${b.name}/${key}: ${e.message}`));
  closeSync(log);
  child.unref(); if (child.pid) writeFileSync(pidFile, String(child.pid)); return true;
}
function displayStart(b) { const p = ports(b.display); const dir = botDir(b.name);
  const passFile = join(dir, ".desktop", "vncpass");
  // TigerVNC reads the standard encrypted VNC password format (not x11vnc's plaintext file).
  const password = spawnSync("x11vnc", ["-storepasswd", b.watchToken, passFile], { timeout: 2000 });
  if (password.status !== 0) throw new Error("Could not prepare the desktop password");
  // One resizable X/VNC server. Only the authenticated gateway can request resizing;
  // VNC clients cannot change the geometry while a bot is working.
  launch(b, "xvfb", "Xtigervnc", [`:${b.display}`, "-geometry", "1280x800", "-depth", "24",
    "-rfbport", String(p.vnc), "-localhost", "-SecurityTypes", "VncAuth", "-rfbauth", passFile,
    "-AlwaysShared", "-AcceptSetDesktopSize=0", "-nolisten", "tcp"]);
  // The X server must accept connections, not just create the socket (otherwise Chromium starts into the void)
  if (!waitFor(() => spawnSync("xdotool", ["getdisplaygeometry"], { env: { ...process.env, DISPLAY: `:${b.display}` } }).status === 0, 15_000)) throw new Error("Display did not become ready");
}
function browserStart(b) {
  displayStart(b);
  const p = ports(b.display), dir = botDir(b.name);
  launch(b, "openbox", "openbox", []);
  spawnSync("xsetroot", ["-solid", "#26262b"], { env: { ...process.env, DISPLAY: `:${b.display}` } }); // calm desktop background
  launch(b, "chromium", "chromium", ["--no-sandbox", "--no-first-run", "--no-default-browser-check", "--disable-dev-shm-usage", "--disable-gpu",
    `--user-data-dir=${join(dir, ".browser")}`, `--remote-debugging-port=${p.cdp}`, "--window-size=1280,800", "--window-position=0,0", "about:blank"]);
  if (!waitFor(() => spawnSync("curl", ["--max-time", "2", "-s", "-o", "/dev/null", "-w", "%{http_code}", `http://127.0.0.1:${p.cdp}/json/version`], { encoding: "utf8" }).stdout === "200", 15_000)) throw new Error("Browser did not become ready");
}
function screenStart(b) {
  browserStart(b);
  const p = ports(b.display), dir = botDir(b.name);
  // Dock at the bottom edge (window switching browser ↔ terminal); sits as a bar above all windows
  launch(b, "tint2", "tint2", ["-c", join(TEMPLATES, "tint2rc")]);
  const web = join(dir, ".desktop", "web", "bots"); mkdirSync(web, { recursive: true });
  if (!existsSync(join(web, b.name))) spawnSync("ln", ["-s", "/usr/share/novnc", join(web, b.name)]);
  launch(b, "novnc", "websockify", ["--web", join(dir, ".desktop", "web"), `0.0.0.0:${p.novnc}`, `127.0.0.1:${p.vnc}`]);
  // Terminal as a window on the desktop (bottom third), operable via the same noVNC.
  // Deliberately AFTER Chromium (and its CDP wait): the most recently mapped window is on top,
  // otherwise the full-screen Chromium covers the terminal. selectToClipboard so that
  // selecting in the terminal reaches the noVNC clipboard bridge.
  if (!waitFor(() => spawnSync("curl", ["--max-time", "2", "-sf", `http://127.0.0.1:${p.novnc}/bots/${b.name}/vnc.html`], { stdio: "ignore" }).status === 0, 10_000)) throw new Error("Screen did not become ready");
  launch(b, "xterm", "xterm", ["-fa", "DejaVu Sans Mono", "-fs", "12", "-bg", "#1b1b1f", "-fg", "#e4e4e9", "-cr", "#9aa4ff",
    "+sb", "-sl", "4000", "-b", "10", "-T", `Terminal – ${b.name}`, "-xrm", "XTerm*selectToClipboard: true",
    "-geometry", "110x12+20+500"]);
}
function terminalStart(b) {
  const p = ports(b.display);
  // Terminal tab of the UI: ttyd (own xterm.js, copy-paste) – loopback only, reachable
  // via the gateway proxy under /bots/<name>/terminal/ (in production behind the Caddy login).
  // Every connection starts a fresh bash in the bot directory (launch sets cwd).
  launch(b, "ttyd", "ttyd", ["-p", String(p.ttyd), "-i", "lo", "-W", "-b", `/bots/${b.name}/terminal`,
    "-t", "fontSize=13", "-t", "cursorBlink=true",
    "-t", 'theme={"background":"#18181b","foreground":"#e4e4e9","cursor":"#9aa4ff"}',
    "bash"]);
  if (!waitFor(() => spawnSync("curl", ["--max-time", "2", "-sf", `http://127.0.0.1:${p.ttyd}/bots/${b.name}/terminal/`], { stdio: "ignore" }).status === 0, 10_000)) throw new Error("Terminal did not become ready");
}
const RESOURCE_KEYS = { browser: ["xvfb", "openbox", "chromium"], desktop: ["xvfb", "openbox", "chromium", "novnc", "tint2", "xterm"], terminal: ["ttyd"] };
export function resourceAlive(b, kind) {
  return RESOURCE_KEYS[kind]?.every((key) => readPid(join(botDir(b.name), ".desktop", `${key}.pid`))) ?? false;
}
function demands(b) {
  try { return JSON.parse(readFileSync(join(botDir(b.name), ".desktop", "demand.json"), "utf8")); } catch { return {}; }
}
// Cross-process serialization: the gateway, MCP and supervisor can request the same
// component together. Atomic creation, bounded wait, stale owner recovery.
function withResourceLock(b, fn) {
  const dir = join(botDir(b.name), ".desktop"); mkdirSync(dir, { recursive: true });
  const lock = join(dir, "start.lock"), deadline = Date.now() + 60_000;
  for (;;) {
    try { const fd = openSync(lock, "wx"); writeFileSync(fd, String(process.pid)); closeSync(fd); break; }
    catch (e) {
      if (e.code !== "EEXIST") throw e;
      let owner; try { owner = Number(readFileSync(lock, "utf8")); } catch {}
      if (owner && !pidAlive(owner)) { rmSync(lock, { force: true }); continue; }
      if (Date.now() > deadline) throw new Error("Computer start is still in progress; try again");
      spawnSync("sleep", ["0.2"]);
    }
  }
  try { return fn(dir); } finally { rmSync(lock, { force: true }); }
}
export function startResource(b, kind) {
  if (!RESOURCE_KEYS[kind]) throw new Error("Expected browser, desktop or terminal");
  return withResourceLock(b, (dir) => {
    b = readBot(b.name);
    if (!b.autostart) throw new Error("Start the bot before opening its computer");
    ensureDesktopConfig(b);
    const requested = { ...demands(b), [kind]: true };
    // A dead display invalidates the GUI children. Repair under the same lock as
    // requests and Stop, so the supervisor cannot tear down an in-flight start.
    if (kind !== "terminal" && existsSync(join(dir, "xvfb.pid")) && !readPid(join(dir, "xvfb.pid"))) stopDesktopProcesses(b);
    writeFileSync(join(dir, "demand.json"), JSON.stringify(requested));
    if (!resourceAlive(b, kind)) ({ browser: browserStart, desktop: screenStart, terminal: terminalStart })[kind](b);
    if (!waitFor(() => resourceAlive(b, kind), 5000)) throw new Error(`${kind} did not become ready`);
  });
}
export function repairResources(b) {
  const requested = demands(b);
  for (const kind of Object.keys(RESOURCE_KEYS)) if (requested[kind] && !resourceAlive(b, kind)) startResource(b, kind);
}
export function desktopStart(b) { startResource(b, "desktop"); }
// Core processes of the desktop – without xterm: if only the terminal is closed (user typed `exit`),
// an idempotent desktopStart is enough, the rest of the chain (browser!) stays untouched.
export function desktopCoreDead(b) { const dir = join(botDir(b.name), ".desktop"); return ["xvfb", "chromium", "novnc"].some((k) => !readPid(join(dir, `${k}.pid`))); }
export function desktopStop(b) {
  if (!existsSync(join(botDir(b.name), ".desktop"))) return;
  return withResourceLock(b, () => stopDesktopProcesses(b));
}
function stopDesktopProcesses(b) {
  const dir = join(botDir(b.name), ".desktop"); if (!existsSync(dir)) return;
  rmSync(join(dir, "demand.json"), { force: true });
  const pids = [];
  for (const key of ["novnc", "x11vnc", "chromium", "xterm", "tint2", "ttyd", "openbox", "xvfb"]) { const pid = readPid(join(dir, `${key}.pid`)); if (pid) { pids.push(pid); try { process.kill(pid, "SIGTERM"); } catch {} } try { rmSync(join(dir, `${key}.pid`), { force: true }); } catch {} }
  // Orphans without a (valid) PID file – e.g. after a container restart or an aborted start – keep
  // display and ports occupied; a new chain would die with "Address already in use". Display and ports
  // are unique per bot, so collect them via command-line pattern as well.
  if (b.display) {
    const p = ports(b.display);
    for (const pat of [`Xvfb :${b.display} `, `Xtigervnc :${b.display} `, `x11vnc .*-rfbport ${p.vnc} `, `websockify .*:${p.novnc} `, `chromium .*--remote-debugging-port=${p.cdp} `, `ttyd .*-p ${p.ttyd} `]) {
      const r = spawnSync("pgrep", ["-f", pat], { encoding: "utf8" });
      for (const line of (r.stdout ?? "").split("\n")) { const pid = Number(line.trim()); if (pid && !pids.includes(pid)) { pids.push(pid); try { process.kill(pid, "SIGTERM"); } catch {} } }
    }
  }
  // Wait for them to end: Chromium still writes to its profile on exit – rm may only delete afterwards.
  const gone = (pid) => { try { process.kill(pid, 0); return false; } catch { return true; } };
  waitFor(() => pids.every(gone), 10_000);
  for (const pid of pids) if (!gone(pid)) { try { process.kill(pid, "SIGKILL"); } catch {} }
}
// xterm/tint2 count too: if the user closes them, the supervisor tick restores them within 30 s
export function desktopAlive(b) { return resourceAlive(b, "desktop"); }
// Fresh container: PID files of the previous one are corpses
export function desktopForgetPids(b) {
  const d = join(botDir(b.name), ".desktop");
  rmSync(join(d, "demand.json"), { force: true });
  rmSync(join(d, "start.lock"), { force: true });
  if (existsSync(d)) for (const k of Object.keys(PROC_MATCH)) rmSync(join(d, `${k}.pid`), { force: true });
}
