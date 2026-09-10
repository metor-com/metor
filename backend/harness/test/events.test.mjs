import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { event, readEvents } from '../bin/metor-events.mjs';

test('event rotation retains bounded history and excludes conversation content', () => {
  const dir = mkdtempSync(join(tmpdir(), 'metor-events-'));
  try {
    event(dir, 'runtime.sleeping', { sessionId: 'session', text: 'private prompt', token: 'private token' });
    const [row] = readEvents(dir);
    assert.equal(row.sessionId, 'session'); assert.equal(row.text, undefined); assert.equal(row.token, undefined);
    assert.ok(Date.parse(row.ts));
    const file = join(dir, 'events.jsonl');
    writeFileSync(file, JSON.stringify(row) + '\n' + ' '.repeat(2 * 1024 * 1024));
    event(dir, 'runtime.waking', { reason: 'message' });
    assert.deepEqual(readEvents(dir).map(e => e.type), ['runtime.sleeping', 'runtime.waking']);
    writeFileSync(file, ' '.repeat(2 * 1024 * 1024));
    event(dir, 'runtime.ready');
    assert.deepEqual(readEvents(dir).map(e => e.type), ['runtime.ready']);
    assert.ok(statSync(file).size < 2048);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('concurrent writers keep each event exactly once', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'metor-events-'));
  try {
    const module = new URL('../bin/metor-events.mjs', import.meta.url).href;
    await Promise.all(Array.from({length: 4}, (_, writer) => new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['--input-type=module', '-e', `import {event} from ${JSON.stringify(module)}; for(let i=0;i<100;i++) event(${JSON.stringify(dir)}, 'turn.started', {turnId: '${writer}-'+i});`]);
      let stderr = ''; child.stderr.on('data', d => stderr += d);
      child.on('error', reject); child.on('exit', code => code || stderr ? reject(new Error(stderr || String(code))) : resolve());
    })));
    const rows = readEvents(dir); assert.equal(rows.length, 400); assert.equal(new Set(rows.map(e => e.turnId)).size, 400);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
