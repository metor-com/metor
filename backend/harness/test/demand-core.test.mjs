import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { injectTurn } from '../bin/metor-chat-stream.mjs';
const delay = ms => new Promise(r => setTimeout(r, ms));
for (const origin of ['user', 'routine']) test(`${origin} wakes a dormant host and delivers the queued turn once`, async () => {
  const root = mkdtempSync(join(tmpdir(), 'metor-demand-')), dir = join(root, 'probe'), meta = join(dir, '.metor');
  mkdirSync(meta, { recursive: true });
  writeFileSync(join(dir, 'bot.json'), JSON.stringify({ name: 'probe', harness: 'codex' }));
  const child = spawn(process.execPath, ['--input-type=module', '-e', `
    import { createCore } from ${JSON.stringify(new URL('../bin/metor-host-core.mjs', import.meta.url).href)};
    const core = createCore('probe');
    await core.waitForDemand(); core.ready();
    for await (const turn of core.turns()) { core.emitText('received:' + turn.text); core.saveState({status:'idle'}); }
  `], { env: { ...process.env, METOR_BOTS_DIR: root }, stdio: 'ignore' });
  const state = () => { try { return JSON.parse(readFileSync(join(meta, 'harness.json'))); } catch { return {}; } };
  const history = () => { try { return readFileSync(join(meta, 'chat.jsonl'), 'utf8'); } catch { return ''; } };
  async function until(check) { for (let i=0;i<100;i++) { if(check()) return; await delay(50); } throw new Error('Timed out'); }
  try {
    await until(() => state().runtimeLoaded === false);
    await delay(400); assert.equal(state().runtimeLoaded, false);
    injectTurn(root, 'probe', 'wake up', { origin });
    await until(() => history().includes('received:wake up'));
    await delay(400);
    assert.equal(state().runtimeLoaded, true);
    assert.equal(history().split('received:wake up').length - 1, 1);
  } finally { const done = once(child, 'exit'); child.kill('SIGTERM'); await done; rmSync(root, { recursive: true, force: true }); }
});
