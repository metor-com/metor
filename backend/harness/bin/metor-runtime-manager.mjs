// A lightweight host owns the runtime worker. Sleeping ends the complete worker
// process group, while the durable inbox, session and separate GUI processes stay.
import { spawn } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { botDir, readBot } from './metor-store.mjs';
import { hostPidMatches } from './metor-lifecycle.mjs';

export const SLEEP_EXIT = 75;
export function idleSeconds(value = process.env.METOR_RUNTIME_IDLE_SECONDS) {
  if (value === undefined || value === '') return 300;
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : 300;
}
const pause = ms => new Promise(r => setTimeout(r, ms));
function json(file) { try { return JSON.parse(readFileSync(file)); } catch { return {}; } }
export function pendingRuntimeDemand(dir) {
  if (existsSync(join(dir, 'runtime-request'))) return true;
  const file = join(dir, 'inbox.jsonl');
  let fd;
  try {
    const size = statSync(file).size;
    let offset = json(join(dir, 'inbox-cursor.json')).offset ?? 0;
    if (offset > size) offset = 0;
    if (offset === size) return false;
    fd = openSync(file, 'r');
    // Read only the undelivered tail, in chunks; incomplete lines wait for append.
    let rest = '';
    while (offset < size) {
      const buffer = Buffer.alloc(Math.min(size - offset, 65536));
      const count = readSync(fd, buffer, 0, buffer.length, offset); if (!count) break;
      offset += count;
      const lines = (rest + buffer.subarray(0, count).toString('utf8')).split('\n'); rest = lines.pop();
      for (const line of lines) { try { const m = JSON.parse(line); if (m.kind === 'user' && typeof m.text === 'string') return true; } catch {} }
    }
  } catch {} finally { if (fd !== undefined) closeSync(fd); }
  return false;
}
function signalGroup(child, signal) { try { process.kill(-child.pid, signal); } catch {} }
async function finishGroup(child) {
  signalGroup(child, 'SIGTERM');
  const deadline = Date.now() + 1500;
  while (Date.now() < deadline) {
    try { process.kill(-child.pid, 0); } catch { return; }
    await pause(100);
  }
  signalGroup(child, 'SIGKILL');
}
export async function manageRuntime(name, workerScript) {
  const dir = join(botDir(name), '.metor'); mkdirSync(dir, { recursive: true });
  const stateFile = join(dir, 'harness.json');
  const previous = json(stateFile);
  if (previous.pid !== process.pid && hostPidMatches({ name }, previous.pid)) throw new Error(`Host for ${name} is already running`);
  let child = null, stopping = false, stopAt = 0;
  const save = patch => {
    const tmp = `${stateFile}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify({ ...json(stateFile), ...patch, pid: process.pid, hostPid: process.pid, updatedAt: new Date().toISOString() }) + '\n');
    renameSync(tmp, stateFile);
    if (patch.runtimeLoaded === false) writeFileSync(join(dir, 'partial.json'), JSON.stringify({ ts: new Date().toISOString(), text: null, thought: null }) + '\n');
  };
  const stop = () => { if (!stopping) stopAt = Date.now(); stopping = true; if (child) { try { child.kill('SIGTERM'); } catch {} } };
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
  console.log(`Host for ${name} started (runtime on demand, sleep after ${idleSeconds()} seconds)`);
  save({ status: 'idle', runtimeLoaded: false, sleeping: false, error: null });
  try {
    while (!stopping) {
      while (!stopping && !pendingRuntimeDemand(dir)) await pause(200);
      if (stopping || !readBot(name).autostart) break;
      rmSync(join(dir, 'runtime-request'), { force: true });
      save({ status: 'starting', runtimeLoaded: true, sleeping: false });
      child = spawn(process.execPath, [workerScript, name, '--worker'], {
        cwd: botDir(name), detached: true, stdio: 'inherit',
        env: { ...process.env, METOR_RUNTIME_PARENT: String(process.pid) },
      });
      // Stop must remain bounded even if the worker fails to handle SIGTERM.
      const watchdog = setInterval(() => { if (stopping && Date.now() - stopAt >= 3000) signalGroup(child, 'SIGKILL'); }, 3000);
      const result = await new Promise(resolve => {
        child.once('exit', (code, signal) => resolve({ code, signal }));
        child.once('error', error => resolve({ error }));
      });
      clearInterval(watchdog);
      await finishGroup(child); child = null;
      if (stopping) break;
      if (result.code !== SLEEP_EXIT) throw result.error ?? new Error(`Runtime worker exited (${result.code ?? result.signal})`);
      save({ status: 'idle', runtimeLoaded: false, sleeping: true, error: null });
      console.log(`Runtime for ${name} sleeping; conversation retained`);
    }
  } finally {
    if (child) await finishGroup(child);
    save({ status: 'stopped', runtimeLoaded: false, sleeping: false });
    process.off('SIGTERM', stop); process.off('SIGINT', stop);
  }
}
