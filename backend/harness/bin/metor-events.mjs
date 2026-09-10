// Durable diagnostic events, independent of chat content. Two bounded generations.
import { appendFileSync, mkdirSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
const LIMIT = 2 * 1024 * 1024;
function locked(dir, fn) {
  mkdirSync(dir, { recursive: true });
  const lock = join(dir, 'events.lock'), deadline = Date.now() + 1000;
  for (;;) {
    try { mkdirSync(lock); break; } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      try { if (Date.now() - statSync(lock).mtimeMs > 10000) { rmSync(lock, { recursive: true, force: true }); continue; } } catch {}
      if (Date.now() >= deadline) throw new Error('Event log lock timed out');
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    }
  }
  try { return fn(); } finally { rmSync(lock, { recursive: true, force: true }); }
}
export function event(dir, type, details = {}) {
  try { locked(dir, () => {
    const row = { v: 1, id: randomUUID(), ts: new Date().toISOString(), type, pid: process.pid };
    // Explicit metadata only: never store prompts, tool output or raw provider errors.
    for (const key of ['runId', 'routineId', 'turnId', 'reason', 'sessionId', 'durationMs', 'code', 'signal'])
      if (details[key] !== undefined && details[key] !== null) row[key] = typeof details[key] === 'string' ? details[key].slice(0, 200) : details[key];
    const file = join(dir, 'events.jsonl'), line = JSON.stringify(row) + '\n';
    let size = 0; try { size = statSync(file).size; } catch {}
    if (size + Buffer.byteLength(line) > LIMIT) renameSync(file, file + '.1');
    appendFileSync(file, line);
  }); } catch (e) { console.error('Event log unavailable:', e.message); }
}
export function readEvents(dir) {
  return locked(dir, () => ['events.jsonl.1', 'events.jsonl'].flatMap(name => {
    let raw; try { raw = readFileSync(join(dir, name), 'utf8'); } catch (e) { if (e.code === 'ENOENT') return []; throw e; }
    return raw.split('\n').flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
  }));
}
