import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { injectTurn } from '../bin/metor-chat-stream.mjs';
import { idleSeconds } from '../bin/metor-runtime-manager.mjs';
const pause = ms => new Promise(r => setTimeout(r, ms));
async function until(check) { for(let i=0;i<200;i++){ if(check()) return; await pause(50); } throw new Error('Timed out'); }
function fixture(seconds) {
  const root=mkdtempSync(join(tmpdir(),'metor-sleep-')), meta=join(root,'probe','.metor'); mkdirSync(meta,{recursive:true});
  writeFileSync(join(root,'probe','bot.json'),JSON.stringify({name:'probe',harness:'codex',autostart:true,model:'old'}));
  const script=join(root,'metor-agent-host.mjs');
  writeFileSync(script, `
    import { manageRuntime } from ${JSON.stringify(new URL('../bin/metor-runtime-manager.mjs',import.meta.url).href)};
    import { createCore } from ${JSON.stringify(new URL('../bin/metor-host-core.mjs',import.meta.url).href)};
    import { fileURLToPath } from 'node:url';
    if(process.argv[3] !== '--worker') await manageRuntime('probe',fileURLToPath(import.meta.url));
    else {
      const core=createCore('probe',{parentPid:process.ppid});
      core.saveState({sessionId:core.state.sessionId??'saved-conversation'});
      core.setCapabilities([], [{id:'old'},{id:'new'}]); core.setModelHandler(async()=>{}); core.ready();
      for await(const turn of core.turns()) {
        if(turn.text==='background') { core.backgroundTasks(['task']); setTimeout(()=>core.backgroundTasks([]),900); }
        if(turn.text==='busy') await new Promise(r=>setTimeout(r,900));
        if(turn.text==='permission') {
          core.saveState({status:'idle'});
          await core.askPermission('test',{title:'Pending approval'});
        }
        core.emitText('received:'+turn.text); core.saveState({status:'idle'});
      }
    }
  `);
  const parent=spawn(process.execPath,[script,'probe'],{env:{...process.env,METOR_BOTS_DIR:root,METOR_RUNTIME_IDLE_SECONDS:String(seconds)},stdio:'ignore'});
  const read=f=>{try{return readFileSync(join(meta,f),'utf8')}catch{return ''}};
  const state=()=>{try{return JSON.parse(read('harness.json'))}catch{return {}}};
  const send=text=>injectTurn(root,'probe',text,{origin:'routine'});
  const close=async()=>{const done=once(parent,'exit');parent.kill('SIGTERM');await done;rmSync(root,{recursive:true,force:true})};
  return {root,meta,parent,read,state,send,close};
}
test('idle runtime sleeps; a message arriving during shutdown wakes once with session and model retained',async()=>{
  const f=fixture(.2);
  try{
    await until(()=>f.state().runtimeLoaded===false); const host=f.state().pid;
    f.send('first'); await until(()=>f.read('chat.jsonl').includes('received:first'));
    await until(()=>f.state().sleeping===true && f.state().runtimeLoaded===true);
    f.send('during shutdown');
    await until(()=>f.read('chat.jsonl').includes('received:during shutdown'));
    await until(()=>f.state().runtimeLoaded===false);
    assert.equal(f.state().pid,host); assert.equal(f.state().sessionId,'saved-conversation');
    assert.equal(f.read('chat.jsonl').split('received:during shutdown').length-1,1);
    appendFileSync(join(f.meta,'inbox.jsonl'),JSON.stringify({id:'switch',kind:'user',text:'/model new',command:'harness:model'})+'\n');
    await until(()=>JSON.parse(readFileSync(join(f.root,'probe','bot.json'))).model==='new');
    await until(()=>f.state().runtimeLoaded===false);
    f.send('after model'); await until(()=>f.read('chat.jsonl').includes('received:after model'));
    assert.equal(f.state().capabilities.currentModel,'new');
    assert.equal(f.state().sessionId,'saved-conversation');
  }finally{await f.close()}
});
test('busy work and pending approvals prevent sleep, and manual Stop never wakes the host',async()=>{
  const f=fixture(.2);
  try{
    await until(()=>f.state().runtimeLoaded===false);
    f.send('background'); await until(()=>f.read('chat.jsonl').includes('received:background')); await pause(450);
    assert.equal(f.state().runtimeLoaded,true); assert.notEqual(f.state().sleeping,true);
    f.send('busy'); await until(()=>f.state().status==='busy'); await pause(450);
    assert.equal(f.state().runtimeLoaded,true); assert.equal(f.state().status,'busy');
    await until(()=>f.read('chat.jsonl').includes('received:busy'));
    f.send('permission'); await until(()=>f.read('chat.jsonl').includes('Pending approval')); await pause(500);
    assert.equal(f.state().runtimeLoaded,true); assert.notEqual(f.state().sleeping,true);
  }finally{await f.close()}
});
test('zero disables sleep and invalid configuration uses five minutes',async()=>{
  assert.equal(idleSeconds('oops'),300); assert.equal(idleSeconds('-1'),300); assert.equal(idleSeconds('0'),0);
  const f=fixture(0);
  try{await until(()=>f.state().runtimeLoaded===false); f.send('awake'); await until(()=>f.read('chat.jsonl').includes('received:awake')); await pause(1200); assert.equal(f.state().runtimeLoaded,true)}finally{await f.close()}
});
