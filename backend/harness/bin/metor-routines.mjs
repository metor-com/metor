// metor-routines – routines store + schedule logic (ADR-0010).
// State: <bot>/.metor/routines.json (machine-readable, workspace-bound) + runs.jsonl (history).
// Written by the MCP tool (metor-routines-mcp.mjs), scheduled by the supervisor (metor.mjs),
// read by the gateway for the panel. Schedule format: standard cron (5 fields), box local time.
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const MAX_ROUTINES = 30;
const RUNS_KEEP = 30;

const routinesFile = (botsDir, bot) => join(botsDir, bot, ".metor", "routines.json");
const runsFile = (botsDir, bot) => join(botsDir, bot, ".metor", "runs.jsonl");

export function readRoutines(botsDir, bot) {
  try { return JSON.parse(readFileSync(routinesFile(botsDir, bot), "utf8")).routines ?? []; } catch { return []; }
}
export function writeRoutines(botsDir, bot, routines) {
  mkdirSync(join(botsDir, bot, ".metor"), { recursive: true });
  writeFileSync(routinesFile(botsDir, bot), JSON.stringify({ v: 1, routines }, null, 2) + "\n");
}
export function addRoutine(botsDir, bot, { name, cron, prompt }) {
  const routines = readRoutines(botsDir, bot);
  if (routines.length >= MAX_ROUTINES) return { error: `At most ${MAX_ROUTINES} routines per bot` };
  const parsed = parseCron(cron);
  if (!parsed) return { error: `Invalid cron expression: ${cron} (expected 5 fields, e.g. "0 7 * * *")` };
  if (typeof prompt !== "string" || !prompt.trim()) return { error: "prompt missing" };
  const r = { id: randomUUID().slice(0, 8), name: String(name ?? "").slice(0, 60) || "Routine", cron, prompt: prompt.trim(),
    enabled: true, createdAt: new Date().toISOString(), lastRunAt: null, nextRunAt: nextRun(parsed, new Date()).toISOString() };
  writeRoutines(botsDir, bot, [...routines, r]);
  return { routine: r };
}
export function updateRoutine(botsDir, bot, { id, name, cron, prompt, enabled } = {}) {
  const routines = readRoutines(botsDir, bot);
  const r = routines.find((x) => x.id === id);
  if (!r) return { error: `Routine ${id} not found` };
  if (cron !== undefined) {
    const parsed = parseCron(cron);
    if (!parsed) return { error: `Invalid cron expression: ${cron} (expected 5 fields, e.g. "0 7 * * *")` };
    r.cron = cron; r.nextRunAt = nextRun(parsed, new Date()).toISOString();
  }
  if (name !== undefined) r.name = String(name).slice(0, 60) || r.name;
  if (prompt !== undefined) {
    if (typeof prompt !== "string" || !prompt.trim()) return { error: "prompt must not be empty" };
    r.prompt = prompt.trim();
  }
  if (enabled !== undefined) {
    r.enabled = !!enabled;
    if (r.enabled) {
      // Resuming counts from now: no catching up of the pause time, auto-pause counter reset
      const parsed = parseCron(r.cron);
      if (parsed) r.nextRunAt = nextRun(parsed, new Date()).toISOString();
      delete r.pausedReason; r.unattendedRuns = 0;
    }
  }
  writeRoutines(botsDir, bot, routines);
  return { routine: r };
}
export function removeRoutine(botsDir, bot, id) {
  const routines = readRoutines(botsDir, bot);
  if (!routines.some((r) => r.id === id)) return { error: `Routine ${id} not found` };
  writeRoutines(botsDir, bot, routines.filter((r) => r.id !== id));
  return { removed: id };
}
export function recordRun(botsDir, bot, routine) {
  appendFileSync(runsFile(botsDir, bot), JSON.stringify({ id: randomUUID().slice(0, 8), routineId: routine.id, name: routine.name, ts: new Date().toISOString() }) + "\n");
}
export function readRuns(botsDir, bot, { limit = RUNS_KEEP } = {}) {
  try {
    return readFileSync(runsFile(botsDir, bot), "utf8").split("\n").filter(Boolean)
      .slice(-limit).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { return []; }
}

// Determine due routines and advance them (called by the supervisor tick).
// Missed times (box was off) are caught up ONCE: nextRunAt is then in the
// past → one fire, then recalculation from now (no batch re-firing).
// Auto-pause: if a routine runs GUARD times without a user message in between
// (injectTurn stamps last-user.json), it is paused instead of burning more quota.
// Returns { due, paused }: due gets fired, paused is reported by the supervisor into the chat.
// empty/unset = default 20; explicit 0 = auto-pause off (Number("") would otherwise silently be 0)
const guardEnv = (process.env.METOR_ROUTINE_GUARD ?? "").trim();
const GUARD = guardEnv === "" ? 20 : Number(guardEnv) || 0;
export function dueRoutines(botsDir, bot, now = new Date()) {
  const routines = readRoutines(botsDir, bot);
  let lastUser = null;
  try { lastUser = JSON.parse(readFileSync(join(botsDir, bot, ".metor", "last-user.json"), "utf8")).ts ?? null; } catch {}
  const due = [], paused = [];
  let changed = false;
  for (const r of routines) {
    if (!r.enabled) continue;
    const parsed = parseCron(r.cron);
    if (!parsed) continue;
    if (!r.nextRunAt) { r.nextRunAt = nextRun(parsed, now).toISOString(); changed = true; continue; }
    if (new Date(r.nextRunAt) <= now) {
      const userSincePrev = !r.lastRunAt || (lastUser && new Date(lastUser) >= new Date(r.lastRunAt));
      r.unattendedRuns = userSincePrev ? 1 : (r.unattendedRuns ?? 0) + 1;
      if (GUARD > 0 && r.unattendedRuns > GUARD) {
        r.enabled = false;
        r.pausedReason = `${GUARD} runs without user activity (auto-pause)`;
        paused.push({ ...r });
        changed = true;
        continue;
      }
      due.push({ ...r });
      r.lastRunAt = now.toISOString();
      r.nextRunAt = nextRun(parsed, now).toISOString();
      changed = true;
    }
  }
  if (changed) writeRoutines(botsDir, bot, routines);
  return { due, paused };
}

// ---------- Mini cron (5 fields: minute hour day-of-month month day-of-week) ----------
// Supports *, numbers, lists (1,2,3), ranges (1-5), steps (*/15, 1-30/5). Local time.
function parseField(field, min, max) {
  const set = new Set();
  for (const part of field.split(",")) {
    const m = /^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/.exec(part.trim());
    if (!m) return null;
    const step = m[2] ? Number(m[2]) : 1;
    let lo = min, hi = max;
    if (m[1] !== "*") {
      const [a, b] = m[1].split("-").map(Number);
      lo = a; hi = b ?? (m[2] ? max : a);
    }
    if (lo < min || hi > max || lo > hi || step < 1) return null;
    for (let v = lo; v <= hi; v += step) set.add(v);
  }
  return set;
}
export function parseCron(expr) {
  const f = String(expr ?? "").trim().split(/\s+/);
  if (f.length !== 5) return null;
  const minute = parseField(f[0], 0, 59), hour = parseField(f[1], 0, 23), dom = parseField(f[2], 1, 31),
    month = parseField(f[3], 1, 12), dow = parseField(f[4], 0, 7);
  if (!minute || !hour || !dom || !month || !dow) return null;
  if (dow.has(7)) dow.add(0); // 7 = Sunday
  return { minute, hour, dom, month, dow, domAny: f[2] === "*", dowAny: f[4] === "*" };
}
export function nextRun(parsed, from) {
  const d = new Date(from.getTime());
  d.setSeconds(0, 0); d.setMinutes(d.getMinutes() + 1);
  for (let i = 0; i < 366 * 24 * 60; i += 1) {           // max. 1 year lookahead
    const okDay = parsed.domAny && parsed.dowAny ? true
      : parsed.domAny ? parsed.dow.has(d.getDay())
      : parsed.dowAny ? parsed.dom.has(d.getDate())
      : parsed.dom.has(d.getDate()) || parsed.dow.has(d.getDay()); // standard cron: dom OR dow
    if (parsed.month.has(d.getMonth() + 1) && okDay && parsed.hour.has(d.getHours()) && parsed.minute.has(d.getMinutes())) return d;
    d.setMinutes(d.getMinutes() + 1);
  }
  return d;
}
