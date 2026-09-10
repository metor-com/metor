// Run only in an isolated Space with an idle Claude smoke bot. No inference request is sent.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const base = 'http://127.0.0.1:6010/bots/api/agents/smoke/chat';
const link = execFileSync('metor', ['auth', 'link', '--plain'], { encoding: 'utf8' }).match(/http[^\s]+claim\?token=[A-Za-z0-9_-]+/)[0];
const claim = await fetch(link, { redirect: 'manual' });
const cookie = claim.headers.get('set-cookie').split(';')[0];
const post = (body) => fetch(base + '/send', { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify(body) });
assert.equal((await fetch(base + '/commands')).status, 401);
let caps;
for (let i = 0; i < 200; i++) {
  caps = await (await fetch(base + '/commands', { method: 'POST', headers: { cookie } })).json();
  if (caps.models?.length) break;
  await new Promise(r => setTimeout(r, 100));
}
assert.ok(caps.models.length > 0);
const command = caps.commands.find((c) => c.action === 'model'); assert.ok(command);
assert.equal((await post({ text: '/quit', command: 'harness:quit' })).status, 400);
assert.equal((await post({ text: `/${command.name} made-up`, command: command.id })).status, 400);
const before = JSON.parse(readFileSync('/workspace/bots/smoke/.metor/harness.json'));
const model = caps.models.find((m) => m.id !== caps.currentModel).id;
assert.equal((await post({ text: `/${command.name} ${model}`, command: command.id, sendId: 'model-test' })).status, 202);
let state;
for (let i = 0; i < 100; i++) {
  state = JSON.parse(readFileSync('/workspace/bots/smoke/.metor/harness.json'));
  if (state.capabilities.currentModel === model && state.status === 'idle') break;
  await new Promise((r) => setTimeout(r, 100));
}
assert.equal(state.capabilities.currentModel, model);
assert.equal(state.sessionId, before.sessionId);
assert.equal(JSON.parse(readFileSync('/workspace/bots/smoke/bot.json')).model, model);
console.log('PASS: authenticated capability endpoint, rejected unknown commands/models and real SDK setModel without a prompt');
