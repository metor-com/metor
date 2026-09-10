import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, appendFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn) { for (let i = 0; i < 100; i++) { if (fn()) return; await delay(50); } throw new Error('Timed out'); }
test('model commands wait for the active turn, preserve session and metadata, and failures do not reach the model', async () => {
  const root = mkdtempSync(join(tmpdir(), 'metor-commands-')), dir = join(root, 'probe'), meta = join(dir, '.metor');
  mkdirSync(meta, { recursive: true });
  writeFileSync(join(dir, 'bot.json'), JSON.stringify({ name: 'probe', harness: 'codex', model: 'old', avatar: { color: '#123456' } }));
  const child = spawn(process.execPath, ['--input-type=module', '-e', `
    import { createCore } from ${JSON.stringify(new URL('../bin/metor-host-core.mjs', import.meta.url).href)};
    import { appendFileSync } from 'node:fs';
    const core = createCore('probe');
    core.saveState({ sessionId: 'same-session' });
    core.setCapabilities([], [{ id: 'old' }, { id: 'new', reasoningEfforts: [{id: 'high'}], defaultReasoningEffort: 'high' }, { id: 'denied' }]);
    core.setModelHandler(async (id) => { if (id === 'denied') throw new Error('Runtime refused'); });
    core.ready();
    for await (const turn of core.turns()) {
      appendFileSync(core.metorDir + '/received', JSON.stringify({text: turn.text, model: core.bot.model}) + '\\n');
      await new Promise((r) => setTimeout(r, 650));
      core.saveState({ status: 'idle' });
    }
  `], { env: { ...process.env, METOR_BOTS_DIR: root }, stdio: 'ignore' });
  const read = (name) => { try { return readFileSync(join(meta, name), 'utf8'); } catch { return ''; } };
  const inbox = (id, text, command) => appendFileSync(join(meta, 'inbox.jsonl'), JSON.stringify({ id, kind: 'user', text, command }) + '\n');
  try {
    await until(() => read('harness.json').includes('idle'));
    inbox('first', 'first');
    await until(() => read('received').includes('first'));
    inbox('switch', '/model new', 'harness:model'); inbox('after', 'after');
    await delay(100);
    assert.equal(JSON.parse(readFileSync(join(dir, 'bot.json'))).model, 'old');
    await until(() => read('received').includes('after'));
    const turns = read('received').trim().split('\n').map(JSON.parse);
    assert.deepEqual(turns, [{ text: 'first', model: 'old' }, { text: 'after', model: 'new' }]);
    assert.equal(JSON.parse(read('harness.json')).sessionId, 'same-session');
    assert.equal(JSON.parse(readFileSync(join(dir, 'bot.json'))).reasoningEffort, 'high');
    assert.equal(JSON.parse(read('harness.json')).capabilities.currentReasoningEffort, 'high');
    assert.equal(JSON.parse(readFileSync(join(dir, 'bot.json'))).avatar.color, '#123456');
    inbox('bad', '/model denied', 'harness:model');
    await until(() => read('chat.jsonl').includes('Runtime refused'));
    assert.equal(JSON.parse(readFileSync(join(dir, 'bot.json'))).model, 'new');
    assert.equal(read('received').includes('/model'), false);
  } finally { const ended = once(child, 'exit'); child.kill('SIGTERM'); await ended; rmSync(root, { recursive: true, force: true }); }
});
