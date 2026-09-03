// metor-desktop – the desktop chain per bot: Xvfb → openbox → tint2 → Chromium (CDP) → x11vnc →
// websockify/noVNC → ttyd (terminal tab) → xterm. One X display per bot, ports derived from it
// (metor-harness.mjs `ports`); PID files under <bot>/.desktop/, idempotent start.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { HARNESSES, harnessOf, ports } from "./metor-harness.mjs";
import { TEMPLATES, allBots, botDir, writeBot } from "./metor-store.mjs";

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
    if (key) { let cmd = ""; try { cmd = readFileSync(`/proc/${n}/cmdline`, "utf8"); } catch { return null; } if (!cmd.includes(PROC_MATCH[key])) return null; }
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
  child.unref(); if (child.pid) writeFileSync(pidFile, String(child.pid)); return true;
}
export function desktopStart(b) {
  ensureDesktopConfig(b); const p = ports(b.display); const dir = botDir(b.name);
  const passFile = join(dir, ".desktop", "vncpass"); writeFileSync(passFile, b.watchToken, { mode: 0o600 });
  launch(b, "xvfb", "Xvfb", [`:${b.display}`, "-screen", "0", "1280x800x24", "-nolisten", "tcp"]);
  // The X server must accept connections, not just create the socket (otherwise Chromium starts into the void)
  waitFor(() => spawnSync("xdotool", ["getdisplaygeometry"], { env: { ...process.env, DISPLAY: `:${b.display}` } }).status === 0, 15_000);
  launch(b, "openbox", "openbox", []);
  spawnSync("xsetroot", ["-solid", "#26262b"], { env: { ...process.env, DISPLAY: `:${b.display}` } }); // calm desktop background
  // Dock at the bottom edge (window switching browser ↔ terminal); sits as a bar above all windows
  launch(b, "tint2", "tint2", ["-c", join(TEMPLATES, "tint2rc")]);
  launch(b, "chromium", "chromium", ["--no-sandbox", "--no-first-run", "--no-default-browser-check", "--disable-dev-shm-usage", "--disable-gpu",
    `--user-data-dir=${join(dir, ".browser")}`, `--remote-debugging-port=${p.cdp}`, "--window-size=1280,800", "--window-position=0,0", "about:blank"]);
  launch(b, "x11vnc", "x11vnc", ["-display", `:${b.display}`, "-rfbport", String(p.vnc), "-localhost", "-forever", "-shared", "-noxdamage", "-quiet", "-passwdfile", passFile]);
  const web = join(dir, ".desktop", "web", "bots"); mkdirSync(web, { recursive: true });
  if (!existsSync(join(web, b.name))) spawnSync("ln", ["-s", "/usr/share/novnc", join(web, b.name)]);
  launch(b, "novnc", "websockify", ["--web", join(dir, ".desktop", "web"), `0.0.0.0:${p.novnc}`, `127.0.0.1:${p.vnc}`]);
  // Terminal tab of the UI: ttyd (own xterm.js, copy-paste) – loopback only, reachable
  // via the gateway proxy under /bots/<name>/terminal/ (in production behind the Caddy login).
  // Every connection starts a fresh bash in the bot directory (launch sets cwd).
  launch(b, "ttyd", "ttyd", ["-p", String(p.ttyd), "-i", "lo", "-W", "-b", `/bots/${b.name}/terminal`,
    "-t", "fontSize=13", "-t", "cursorBlink=true",
    "-t", 'theme={"background":"#18181b","foreground":"#e4e4e9","cursor":"#9aa4ff"}',
    "bash"]);
  waitFor(() => spawnSync("curl", ["-s", "-o", "/dev/null", "-w", "%{http_code}", `http://127.0.0.1:${p.cdp}/json/version`], { encoding: "utf8" }).stdout === "200", 15_000);
  // Terminal as a window on the desktop (bottom third), operable via the same noVNC.
  // Deliberately AFTER Chromium (and its CDP wait): the most recently mapped window is on top,
  // otherwise the full-screen Chromium covers the terminal. selectToClipboard so that
  // selecting in the terminal reaches the noVNC clipboard bridge.
  launch(b, "xterm", "xterm", ["-fa", "DejaVu Sans Mono", "-fs", "12", "-bg", "#1b1b1f", "-fg", "#e4e4e9", "-cr", "#9aa4ff",
    "+sb", "-sl", "4000", "-b", "10", "-T", `Terminal – ${b.name}`, "-xrm", "XTerm*selectToClipboard: true",
    "-geometry", "110x12+20+500"]);
}
// Core processes of the desktop – without xterm: if only the terminal is closed (user typed `exit`),
// an idempotent desktopStart is enough, the rest of the chain (browser!) stays untouched.
export function desktopCoreDead(b) { const dir = join(botDir(b.name), ".desktop"); return ["xvfb", "chromium", "x11vnc", "novnc"].some((k) => !readPid(join(dir, `${k}.pid`))); }
export function desktopStop(b) {
  const dir = join(botDir(b.name), ".desktop"); if (!existsSync(dir)) return;
  const pids = [];
  for (const key of ["novnc", "x11vnc", "chromium", "xterm", "tint2", "ttyd", "openbox", "xvfb"]) { const pid = readPid(join(dir, `${key}.pid`)); if (pid) { pids.push(pid); try { process.kill(pid, "SIGTERM"); } catch {} } try { rmSync(join(dir, `${key}.pid`), { force: true }); } catch {} }
  // Orphans without a (valid) PID file – e.g. after a container restart or an aborted start – keep
  // display and ports occupied; a new chain would die with "Address already in use". Display and ports
  // are unique per bot, so collect them via command-line pattern as well.
  if (b.display) {
    const p = ports(b.display);
    for (const pat of [`Xvfb :${b.display} `, `x11vnc .*-rfbport ${p.vnc} `, `websockify .*:${p.novnc} `, `chromium .*--remote-debugging-port=${p.cdp} `, `ttyd .*-p ${p.ttyd} `]) {
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
export function desktopAlive(b) { const dir = join(botDir(b.name), ".desktop"); return ["xvfb", "chromium", "xterm", "tint2", "x11vnc", "novnc", "ttyd"].every((k) => readPid(join(dir, `${k}.pid`))); }
// Fresh container: PID files of the previous one are corpses
export function desktopForgetPids(b) {
  const d = join(botDir(b.name), ".desktop");
  if (existsSync(d)) for (const k of Object.keys(PROC_MATCH)) rmSync(join(d, `${k}.pid`), { force: true });
}
