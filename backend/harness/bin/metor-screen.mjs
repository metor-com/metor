// Resize only from the authenticated gateway, while the bot is idle.
import { writeFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { spawnSync } from "node:child_process";

export function screenSize(width, height) {
  if (![width, height].every((v) => Number.isInteger(v) && v >= 1 && v <= 8192)) throw new Error("Invalid screen size");
  return { width: Math.max(320, Math.min(2560, width)), height: Math.max(320, Math.min(1600, height)) };
}

export function resizeScreen(display, width, height) {
  const size = screenSize(width, height);
  if (!Number.isInteger(display) || display < 1) throw new Error("No desktop");
  const env = { ...process.env, DISPLAY: `:${display}` };
  const run = (cmd, args) => {
    const r = spawnSync(cmd, args, { env, encoding: "utf8", timeout: 2000 });
    if (r.status !== 0) throw new Error("Screen resizing is unavailable. Update the Space and restart the bot.");
    return r.stdout.trim();
  };
  const current = run("xdotool", ["getdisplaygeometry"]);
  if (current === `${size.width} ${size.height}`) return size;
  const modes = run("xrandr", []);
  if (!/^VNC-0 /m.test(modes)) throw new Error("Screen resizing needs an updated Space. Update it and restart the bot.");
  const { width: w, height: h } = size;
  const mode = `metor-${w}x${h}`;
  if (!modes.includes(mode)) {
    // Virtual timing: no physical monitor, so use a small fixed blanking interval.
    run("xrandr", ["--newmode", mode, String((w + 40) * (h + 30) * 60 / 1e6),
      String(w), String(w + 8), String(w + 16), String(w + 40), String(h), String(h + 3), String(h + 6), String(h + 30)]);
    run("xrandr", ["--addmode", "VNC-0", mode]);
  }
  run("xrandr", ["--output", "VNC-0", "--mode", mode]);
  // Keep browser content filling the new desktop without reloading its tabs.
  const windows = spawnSync("xdotool", ["search", "--onlyvisible", "--class", "chromium"], { env, encoding: "utf8", timeout: 2000 });
  for (const id of (windows.stdout ?? "").trim().split(/\s+/).filter((v) => /^\d+$/.test(v))) {
    spawnSync("xdotool", ["windowmove", id, "0", "0", "windowsize", id, String(w), String(h)], { env, timeout: 2000 });
  }
  // Retain only the active generated mode; repeated divider drags must not accumulate modes.
  for (const old of modes.match(/metor-\d+x\d+/g) ?? []) if (old !== mode) {
    spawnSync("xrandr", ["--delmode", "VNC-0", old], { env, timeout: 2000 });
    spawnSync("xrandr", ["--rmmode", old], { env, timeout: 2000 });
  }
  return size;
}

// The gateway publishes its marker BEFORE checking idle. The host publishes busy BEFORE
// waiting for markers. Whichever starts first wins; no new turn overlaps a resize.
export function withScreenResizeLock(metorDir, isIdle, resize) {
  const marker = join(metorDir, `screen-resize-${process.pid}`);
  writeFileSync(marker, "", { mode: 0o600 });
  try { return isIdle() ? resize() : { deferred: true }; }
  finally { rmSync(marker, { force: true }); }
}
export async function waitForScreenResize(metorDir) {
  for (;;) {
    let active = false;
    for (const file of readdirSync(metorDir)) {
      const match = /^screen-resize-(\d+)$/.exec(file);
      if (!match) continue;
      try { process.kill(Number(match[1]), 0); active = true; }
      catch { rmSync(join(metorDir, file), { force: true }); }
    }
    if (!active) return;
    await delay(20);
  }
}
