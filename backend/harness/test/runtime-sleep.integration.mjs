// Run in an isolated Space with METOR_RUNTIME_IDLE_SECONDS=2. No inference prompt.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
const cli=(...args)=>execFileSync('metor',args,{encoding:'utf8'});
const name='sleep-probe';
cli('bot','create',name,'--harness','codex');
const state=()=>JSON.parse(readFileSync(`/workspace/bots/${name}/.metor/harness.json`));
const host=state().pid;
const link=cli('auth','link','--plain').match(/http[^\s]+claim\?token=[A-Za-z0-9_-]+/)[0];
const claim=await fetch(link,{redirect:'manual'}),cookie=claim.headers.get('set-cookie').split(';')[0];
const req=(path,method='GET',body)=>fetch(`http://127.0.0.1:6010/bots/api/agents/${name}/${path}`,{method,headers:{cookie,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
async function until(check){for(let i=0;i<300;i++){if(await check())return;await new Promise(r=>setTimeout(r,100))}throw new Error('Timed out: '+JSON.stringify(state()))}
cli('bot','computer',name,'desktop');
const browserPid=readFileSync(`/workspace/bots/${name}/.desktop/chromium.pid`,'utf8');
const display=JSON.parse(readFileSync(`/workspace/bots/${name}/bot.json`)).display;
const tabs=await(await fetch(`http://127.0.0.1:${9200+display}/json/list`)).json();
await req('chat/commands','POST');
await until(()=>state().capabilities?.models?.length && state().status==='idle');
const session=state().sessionId,worker=state().pid;
assert.ok(session);assert.notEqual(worker,host);
const model=state().capabilities.models.find(m=>m.reasoningEfforts?.length);
const effort=model.reasoningEfforts.at(-1).id;
assert.equal((await req('chat/send','POST',{text:`/model ${model.id} ${effort}`,command:'harness:model'})).status,202);
await until(()=>state().capabilities.currentReasoningEffort===effort);
await until(async()=>{
  const agents=await(await fetch('http://127.0.0.1:6010/bots/api/agents',{headers:{cookie}})).json();
  assert.notEqual(agents.find(a=>a.name===name).status,'stopped');
  return state().runtimeLoaded===false && state().sleeping===true;
});
assert.equal(state().pid,host);
assert.equal(state().sessionId,session);
assert.throws(()=>process.kill(worker,0));
assert.ok(!execFileSync("ps",["-eo","pgid="],{encoding:"utf8"}).split("\n").some(line=>Number(line.trim())===worker));
assert.equal(readFileSync(`/workspace/bots/${name}/.desktop/chromium.pid`,'utf8'),browserPid);
assert.deepEqual((await(await fetch(`http://127.0.0.1:${9200+display}/json/list`)).json()).map(t=>t.id),tabs.map(t=>t.id));
console.log('PASS: Codex and its worker leave memory; browser PID and tabs remain intact');
await req('chat/commands'); // Background capability polling must not wake it.
await new Promise(r=>setTimeout(r,500));assert.equal(state().runtimeLoaded,false);
await req('chat/commands','POST');
await until(()=>state().status==='idle' && state().runtimeLoaded===true && state().capabilities?.models?.length);
// An empty Codex thread has no rollout until an inference turn. Its ID may
// change on resume; this test intentionally sends only local model commands.
assert.ok(state().sessionId);
assert.equal(state().conversationStarted,false);
assert.equal(state().capabilities.currentModel,model.id);
assert.equal(state().capabilities.currentReasoningEffort,effort);
console.log('PASS: explicit command discovery restores model and effort without inference');
await until(()=>state().sleeping===true && state().runtimeLoaded===false);
cli('bot','stop',name);
assert.equal(state().status,'stopped');
await new Promise(r=>setTimeout(r,500));assert.throws(()=>process.kill(host,0));
console.log('PASS: manual Stop ends the lightweight host too');
cli('bot','rm',name);

const claude='sleep-claude';
cli('bot','create',claude);
const claudeState=()=>JSON.parse(readFileSync(`/workspace/bots/${claude}/.metor/harness.json`));
const claudeHost=claudeState().pid;
const discover=()=>fetch(`http://127.0.0.1:6010/bots/api/agents/${claude}/chat/commands`,{method:'POST',headers:{cookie}});
async function waitClaude(check){for(let i=0;i<150;i++){const s=claudeState();assert.notEqual(s.status,'stopped');if(check(s))return;await new Promise(r=>setTimeout(r,100))}throw new Error('Claude sleep/wake timed out')}
await discover();
await waitClaude(s=>s.status==='idle' && s.capabilities?.models?.length);
await waitClaude(s=>s.sleeping && s.runtimeLoaded===false);
assert.equal(claudeState().pid,claudeHost);
await discover();
await waitClaude(s=>s.status==='idle' && s.runtimeLoaded===true && s.capabilities?.models?.length);
await waitClaude(s=>s.sleeping && s.runtimeLoaded===false);
assert.equal(claudeState().pid,claudeHost);
console.log('PASS: Claude SDK stream shutdown sleeps and wakes twice without stopping its host');
cli('bot','rm',claude);
