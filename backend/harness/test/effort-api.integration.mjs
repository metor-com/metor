// Run in an isolated test Space. Creates a disposable Codex bot; sends no inference prompt.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
const bot = 'effort-probe';
execFileSync('metor', ['bot', 'create', bot, '--harness', 'codex', '--no-start', '--role', 'Temporary reasoning configuration test.']);
execFileSync('metor', ['bot', 'start', bot]);
const link = execFileSync('metor', ['auth', 'link', '--plain'], {encoding:'utf8'}).match(/http[^\s]+claim\?token=[A-Za-z0-9_-]+/)[0];
const claim = await fetch(link, {redirect:'manual'}), cookie = claim.headers.get('set-cookie').split(';')[0];
const base = `http://127.0.0.1:6010/bots/api/agents/${bot}/chat`;
const caps = async () => (await fetch(base + '/commands', {headers:{cookie}})).json();
async function until(check) { for (let i=0;i<100;i++) { const c=await caps(); if(check(c)) return c; await new Promise(r=>setTimeout(r,100)); } throw new Error('Timed out'); }
const before = await until(c=>c.models?.length);
const model = before.models.find(m=>m.reasoningEfforts?.length>1); assert.ok(model);
const effort = model.reasoningEfforts.at(-1).id;
const post = (text) => fetch(base+'/send', {method:'POST', headers:{cookie,'content-type':'application/json'},body:JSON.stringify({text, command:'harness:model'})});
assert.equal((await post(`/model ${model.id} invented`)).status,400);
assert.equal((await post(`/model ${model.id} ${effort}`)).status,202);
await until(c=>c.currentModel===model.id && c.currentReasoningEffort===effort);
assert.equal(JSON.parse(readFileSync(`/workspace/bots/${bot}/bot.json`)).reasoningEffort,effort);
execFileSync('metor',['bot','stop',bot]); execFileSync('metor',['bot','start',bot]);
await until(c=>c.currentModel===model.id && c.currentReasoningEffort===effort);
console.log('PASS: live Codex effort discovery, validation, persistence and restart without an inference prompt');
