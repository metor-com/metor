import { encodeBotZip, decodeBotZip } from './metor-bot-zip.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { once } from 'node:events';

test('gateway package API: paused snapshot, import, conflict, hostile paths and CSRF', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'metor-package-api-'));
  const portServer = createServer(); portServer.listen(0, '127.0.0.1'); await once(portServer, 'listening');
  const port = portServer.address().port; await new Promise((r) => portServer.close(r));
  mkdirSync(join(root, 'bots/source'), { recursive: true });
  const bot = { name: 'source', title: 'Source', role: 'Portable role', harness: 'codex', model: 'default', autostart: false, sessionId: null };
  const botFile = join(root, 'bots/source/bot.json');
  writeFileSync(botFile, JSON.stringify(bot)); writeFileSync(join(root, 'bots/source/notes.md'), 'Keep this.');
  const child = spawn(process.execPath, [new URL('./metor-gateway.mjs', import.meta.url).pathname], {
    env: { ...process.env, METOR_BOTS_DIR: join(root, 'bots'), METOR_AUTH_DIR: join(root, 'auth'), METOR_WORKSPACE_DIR: root, METOR_GATEWAY_PORT: String(port), METOR_AUTH: 'off', METOR_UPDATE_CHECK: 'off' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(async () => { child.kill(); await once(child, 'exit').catch(() => {}); rmSync(root, { recursive: true, force: true }); });
  await Promise.race([once(child.stdout, 'data'), new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('Gateway did not start')), 10000); timer.unref(); })]);
  const base = `http://127.0.0.1:${port}/bots/api`;
  const post = (path, body, headers = {}) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  const upload = (path, archive, headers = {}) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/zip', ...headers }, body: archive });
  let r = await post('/agents/source/package', { includeFiles: true, handoff: 'Next task' });
  assert.equal(r.status, 200); assert.equal(r.headers.get('content-type'), 'application/zip'); const archive = Buffer.from(await r.arrayBuffer()); const pkg = decodeBotZip(archive);
  r = await upload('/bot-packages/inspect', archive); assert.equal(r.status, 200); assert.equal((await r.json()).files, 1);
  writeFileSync(botFile, JSON.stringify({ ...bot, autostart: true }));
  r = await post('/agents/source/package', { files: [] }); assert.equal(r.status, 409);
  writeFileSync(botFile, JSON.stringify(bot));
  r = await upload('/bot-packages/import?title=Copy', archive); assert.equal(r.status, 201);
  assert.deepEqual(await r.json(), { name: 'copy', title: 'Copy' });
  assert.equal(JSON.parse(readFileSync(join(root, 'bots/copy/bot.json'))).autostart, false);
  assert.equal(readFileSync(join(root, 'bots/copy/notes.md'), 'utf8'), 'Keep this.');
  r = await upload('/bot-packages/import?title=Copy', archive); assert.equal(r.status, 400);
  r = await upload('/bot-packages/import?title=Bad', encodeBotZip({ ...pkg, files: [{ path: '../escape', data: 'eA==' }] })); assert.equal(r.status, 400);
  r = await upload('/bot-packages/import?title=Foreign', archive, { origin: 'https://foreign.invalid' }); assert.equal(r.status, 403);
});
