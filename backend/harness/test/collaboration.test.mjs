import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync, linkSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { collaborationCall as call, deliverOutbox, assignmentStarted, assignmentApproval, claimNotifications } from '../bin/metor-collaboration.mjs';
import { transaction } from '../bin/metor-durable.mjs';
import { readHistory, injectTurn } from '../bin/metor-chat-stream.mjs';
import { publishTriggerEvent, drainTriggerEvents } from '../bin/metor-trigger-events.mjs';
import { addEventRoutine, addRoutine, dueRoutines } from '../bin/metor-routines.mjs';
import { pendingRuntimeDemand } from '../bin/metor-runtime-manager.mjs';
const lib = new URL('../bin/', import.meta.url).href;
function fixture(t) {
  const workspace=mkdtempSync(join(tmpdir(),'metor-collaboration-')), root=join(workspace,'bots');
  for (const [name,harness] of [['alpha','claude-stream'],['beta','codex'],['gamma','gemini'],['delta','copilot']]) {
    mkdirSync(join(root,name,'.metor'),{recursive:true});
    writeFileSync(join(root,name,'bot.json'),JSON.stringify({name,harness,role:`Role of ${name}`,autostart:true}));
  }
  mkdirSync(join(workspace,'shared')); t.after(()=>rmSync(workspace,{recursive:true,force:true}));
  return root;
}
const readLines=file=>{try{return readFileSync(file,'utf8').split('\n').filter(Boolean).map(JSON.parse)}catch{return []}};
function child(root,code) {
  const p=spawn(process.execPath,['--input-type=module','-e',code],{env:{...process.env,METOR_BOTS_DIR:root},stdio:['ignore','pipe','pipe']});
  let output='';p.stderr.on('data',b=>output+=b); const done=once(p,'exit').then(([code,signal])=>({code,signal,output})); return {p,done};
}

test('runtime-neutral roster, fixed sender, paused delivery, shared references, explicit results and durable notification dedup',t=>{
  const root=fixture(t);
  assert.deepEqual(call(root,'alpha','list_bots').bots.map(b=>b.runtime).sort(),['claude-stream','codex','copilot','gemini']);
  assert.throws(()=>call(root,'alpha','send_to_bot',{to:'beta',text:'x',request_id:'x',sender:'gamma'}),/identity/);
  assert.throws(()=>call(root,'alpha','send_to_bot',{to:'alpha',text:'x',request_id:'self'}),/yourself/);
  assert.throws(()=>call(root,'alpha','send_to_bot',{to:'../outside',text:'x',request_id:'escape'}),/Invalid bot/);
  writeFileSync(join(root,'beta','bot.json'),JSON.stringify({name:'beta',harness:'codex',autostart:false}));
  const args={to:'beta',goal:'Create the summary',request_id:'task-1'}, a=call(root,'alpha','assign_task',args);
  assert.equal(a.delivery,'waiting_for_bot_to_start');
  assert.deepEqual(call(root,'alpha','assign_task',args),a);
  assert.throws(()=>call(root,'alpha','assign_task',{...args,goal:'Different'}),/already used/);
  deliverOutbox(root); deliverOutbox(root);
  assert.equal(readLines(join(root,'beta','.metor/inbox.jsonl')).length,1);
  assert.equal(JSON.parse(readFileSync(join(root,'beta','bot.json'))).autostart,false);
  assert.equal(pendingRuntimeDemand(join(root,'beta','.metor')),true);
  const meta=readHistory(root,'beta')[0].collaboration;
  assignmentStarted(root,'beta',meta);
  assert.equal(call(root,'alpha','get_assignment',{id:a.id}).status,'working');
  assignmentApproval(root,'beta',meta,'permission-1');
  assert.equal(call(root,'alpha','get_assignment',{id:a.id}).status,'needs_approval');
  assignmentApproval(root,'beta',meta,'permission-1','allow');
  writeFileSync(join(root,'../shared','summary.txt'),'The result');
  writeFileSync(join(root,'../secret'),'secret'); symlinkSync('../secret',join(root,'../shared','escape')); linkSync(join(root,'../secret'),join(root,'../shared','hardlink'));
  for (const file of ['../secret','/etc/passwd','escape','hardlink']) assert.throws(()=>call(root,'beta','report_assignment',{id:a.id,status:'completed',result:'Done',files:[file],request_id:`file-${file}`}),/path|outside|relative/i);
  assert.throws(()=>call(root,'gamma','report_assignment',{id:a.id,status:'completed',result:'No',request_id:'spoof'}),/Only/);
  const report={id:a.id,status:'completed',result:'Summary ready',files:['summary.txt'],request_id:'result-1'};
  const completed=call(root,'beta','report_assignment',report);
  assert.deepEqual(call(root,'beta','report_assignment',report),completed);
  assert.equal(completed.files[0].path,'summary.txt');
  deliverOutbox(root); deliverOutbox(root);
  assert.equal(readHistory(root,'alpha').filter(e=>e.collaboration?.status==='completed').length,1);
  assert.equal(claimNotifications(root).length,1); assert.equal(claimNotifications(root).length,0);
  assert.throws(()=>call(root,'beta','report_assignment',{...report,request_id:'late',status:'failed'}),/already final/);
});

test('SIGKILL after inbox append but before receipt: one physical delivery, replayable result and concurrent retries',async t=>{
  const root=fixture(t), a=call(root,'alpha','assign_task',{to:'beta',goal:'Durable task',request_id:'task'});
  const crash=child(root,`import {deliverOutbox} from '${lib}metor-collaboration.mjs'; deliverOutbox(process.env.METOR_BOTS_DIR,{afterAppend(){process.kill(process.pid,'SIGKILL')}});`);
  assert.equal((await crash.done).signal,'SIGKILL');
  assert.equal(readLines(join(root,'beta','.metor/inbox.jsonl')).length,1);
  deliverOutbox(root);
  assert.equal(readLines(join(root,'beta','.metor/inbox.jsonl')).length,1);
  const code=`import {collaborationCall,deliverOutbox} from '${lib}metor-collaboration.mjs'; collaborationCall(process.env.METOR_BOTS_DIR,'beta','report_assignment',${JSON.stringify({id:a.id,status:'completed',result:'Done',request_id:'final'})}); deliverOutbox(process.env.METOR_BOTS_DIR);`;
  const lostReply=child(root,code.replace(' deliverOutbox(process.env.METOR_BOTS_DIR);', " process.kill(process.pid,'SIGKILL');"));
  assert.equal((await lostReply.done).signal,'SIGKILL');
  const children=Array.from({length:8},()=>child(root,code));
  for (const result of await Promise.all(children.map(c=>c.done))) assert.equal(result.code,0,result.output);
  assert.equal(readHistory(root,'alpha').filter(e=>e.collaboration?.status==='completed').length,1);
  assert.equal(transaction(root,s=>s.rows('events').filter(r=>r.event.type==='assignment.completed')).length,1);
});

test('event fan-out survives one failed recipient, receipt-window replay and WAL checkpoint; cron remains independent',t=>{
  const root=fixture(t);
  for(const name of ['alpha','beta']) addEventRoutine(root,name,{name:'Completion',source:'metor',event:'assignment.completed',prompt:'Review'});
  const input={id:'e1',source:'metor',type:'assignment.completed',data:{result:'ok'}};
  publishTriggerEvent(root,input); publishTriggerEvent(root,input);
  assert.throws(()=>publishTriggerEvent(root,{...input,data:{result:'different'}}),/reused/);
  const fire=(b,r,e,d)=>injectTurn(root,b.name,r.prompt,{origin:'event',routine:r,...d});
  const first=drainTriggerEvents(root,[{name:'alpha'},{name:'beta'}],(b,r,e,d)=>{
    fire(b,r,e,d); if(b.name==='alpha') throw new Error('Crash before acknowledgement');
  });
  assert.equal(first.length,1);
  drainTriggerEvents(root,[{name:'alpha'},{name:'beta'}],fire);
  for(const name of ['alpha','beta']) assert.equal(readLines(join(root,name,'.metor/inbox.jsonl')).length,1);
  // WAL checkpoint is the replacement for the lossy JSONL rotation; it preserves pending rows.
  const later={...input,id:'e2'};publishTriggerEvent(root,later);
  return import('node:sqlite').then(({DatabaseSync})=>{
    const db=new DatabaseSync(join(root,'.collaboration/state.sqlite'));db.exec('PRAGMA wal_checkpoint(TRUNCATE)');db.close();
    drainTriggerEvents(root,[{name:'alpha'},{name:'beta'}],fire);
    for(const name of ['alpha','beta']) assert.equal(readLines(join(root,name,'.metor/inbox.jsonl')).length,2);
    addRoutine(root,'alpha',{name:'Clock',cron:'* * * * *',prompt:'Clock tick'});
    const fired=[]; dueRoutines(root,'alpha',new Date(Date.now()+120000),r=>fired.push(r));
    assert.equal(fired.length,1);assert.equal(fired[0].name,'Clock');
  });
});

test('technical chain and hourly limits survive restarts and retries consume no additional budget',t=>{
  const root=fixture(t);
  writeFileSync(join(root,'alpha','.metor/harness.json'),JSON.stringify({activeTurn:{turnId:'user-turn',collaboration:{correlationId:'chain',depth:0}}}));
  for(let n=0;n<12;n++) call(root,'alpha','send_to_bot',{to:'beta',text:'Useful update',request_id:`m${n}`});
  assert.throws(()=>call(root,'alpha','send_to_bot',{to:'beta',text:'Too much',request_id:'m12'}),/budget/);
  assert.ok(call(root,'alpha','send_to_bot',{to:'beta',text:'Useful update',request_id:'m0'}));
  writeFileSync(join(root,'alpha','.metor/harness.json'),JSON.stringify({activeTurn:{collaboration:{depth:6,correlationId:'next'}}}));
  assert.throws(()=>call(root,'alpha','send_to_bot',{to:'beta',text:'Too deep',request_id:'deep'}),/hop/);
  writeFileSync(join(root,'alpha','.metor/harness.json'),'{}');
  for(let n=12;n<30;n++) call(root,'alpha','send_to_bot',{to:'beta',text:'Update',request_id:`m${n}`});
  assert.throws(()=>call(root,'alpha','send_to_bot',{to:'beta',text:'Too many',request_id:'m30'}),/hour/);
});

const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn) { for(let i=0;i<200;i++){if(fn())return;await pause(50)}throw new Error('Timed out'); }
test('user priority survives out-of-order acknowledgement and worker death; unacknowledged active turns replay',async t=>{
  const root=fixture(t), received=join(root,'received.jsonl');
  injectTurn(root,'alpha','bot work',{origin:'bot',id:'bot-turn'});
  injectTurn(root,'alpha','user work',{id:'user-turn'});
  const code=kill=>`import {createCore} from '${lib}metor-host-core.mjs'; import {appendFileSync} from 'node:fs';
    const core=createCore('alpha');core.ready();for await(const turn of core.turns()){
      appendFileSync(${JSON.stringify(received)},JSON.stringify({id:turn.id})+'\\n');
      ${kill==='active' ? "process.kill(process.pid,'SIGKILL');" : "core.finishTurn();"}
      ${kill ? "process.kill(process.pid,'SIGKILL');" : 'process.exit(0);'}
    }`;
  assert.equal((await child(root,code('ack')).done).signal,'SIGKILL');
  assert.equal(readLines(received)[0].id,'user-turn');
  assert.equal((await child(root,code('active')).done).signal,'SIGKILL');
  assert.equal((await child(root,code(false)).done).code,0);
  assert.deepEqual(readLines(received).map(r=>r.id),['user-turn','bot-turn','bot-turn']);
  assert.equal(pendingRuntimeDemand(join(root,'alpha','.metor')),false);
});

test('two-bot E2E via stdio MCP and real runtime manager: paused recipient, memory admission, sleep, report and requester wake',async t=>{
  const root=fixture(t), worker=join(root,'metor-agent-host.mjs'), memory=join(root,'memory.json');
  const mem=low=>writeFileSync(memory,JSON.stringify({available:true,low,availableBytes:low?100:2*1024**3,requiredBytes:768*1024**2}));
  mem(true);
  writeFileSync(worker,`
    import {manageRuntime} from '${lib}metor-runtime-manager.mjs';
    import {createCore} from '${lib}metor-host-core.mjs';
    import {createMemoryGuard} from '${lib}metor-memory.mjs';
    import {readFileSync,writeFileSync} from 'node:fs';import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
    const name=process.argv[2],root=process.env.METOR_BOTS_DIR;
    const rpc=(tool,args)=>{
      const r=spawnSync(process.execPath,[fileURLToPath(new URL('metor-collaboration-mcp.mjs',${JSON.stringify(lib)})),name],{env:process.env,input:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:tool,arguments:args}})+'\\n',encoding:'utf8'});
      if(r.status!==0)throw Error(r.stderr); const m=JSON.parse(r.stdout);if(m.result.isError)throw Error(m.result.content[0].text);return JSON.parse(m.result.content[0].text);
    };
    if(process.argv[3]!=='--worker') await manageRuntime(name,fileURLToPath(import.meta.url),{memory:createMemoryGuard({sample:()=>JSON.parse(readFileSync(${JSON.stringify(memory)}))})});
    else {const core=createCore(name,{parentPid:process.ppid});core.ready();for await(const turn of core.turns()){
      if(name==='alpha' && !turn.origin){
        const a=rpc('assign_task',{to:'beta',goal:'Write a summary file',request_id:turn.id});writeFileSync(root+'/assignment.json',JSON.stringify(a));
      } else if(name==='beta') {
        writeFileSync(root+'/../shared/result.txt','Completed by beta');
        rpc('report_assignment',{id:turn.collaboration.assignmentId,status:'completed',result:'Summary ready',files:['result.txt'],request_id:turn.id+'-result'});
      } else core.emitText('Result received: '+turn.collaboration.status);
      core.finishTurn();core.saveState({status:'idle'});
    }}
  `);
  const parents=[];
  const start=name=>{const p=spawn(process.execPath,[worker,name],{env:{...process.env,METOR_BOTS_DIR:root,METOR_RUNTIME_IDLE_SECONDS:'.2'},stdio:'ignore'});parents.push(p);return p};
  t.after(async()=>{for(const p of parents)if(p.exitCode===null&&p.signalCode===null){const done=once(p,'exit');p.kill();await done}});
  const state=name=>{try{return JSON.parse(readFileSync(join(root,name,'.metor/harness.json')))}catch{return {}}};
  // Alpha has already been given the user's task. Beta is intentionally paused.
  writeFileSync(join(root,'beta','bot.json'),JSON.stringify({name:'beta',harness:'codex',autostart:false}));
  start('alpha');await until(()=>state('alpha').runtimeLoaded===false);
  injectTurn(root,'alpha','Delegate the summary');
  await until(()=>state('alpha').waitingForMemory);assert.equal(state('alpha').runtimeLoaded,false);
  mem(false);await until(()=>readLines(join(root,'beta','.metor/inbox.jsonl')).length===1);
  await until(()=>state('alpha').runtimeLoaded===false && state('alpha').sleeping);
  assert.equal(state('beta').pid,undefined);
  const a=JSON.parse(readFileSync(join(root,'assignment.json')));assert.equal(a.delivery,'waiting_for_bot_to_start');
  mem(true);writeFileSync(join(root,'beta','bot.json'),JSON.stringify({name:'beta',harness:'codex',autostart:true}));start('beta');
  await until(()=>state('beta').waitingForMemory);assert.equal(state('beta').runtimeLoaded,false);
  mem(false);await until(()=>readHistory(root,'alpha').some(e=>e.text==='Result received: completed'));
  assert.equal(call(root,'alpha','get_assignment',{id:a.id}).status,'completed');
  assert.equal(readHistory(root,'alpha').filter(e=>e.collaboration?.status==='completed'&&e.role==='user').length,1);
  assert.equal(readFileSync(join(root,'../shared/result.txt'),'utf8'),'Completed by beta');
});

test('a reported final assignment is not executed again after an unacknowledged turn; torn UTF-8 inbox tails are reread',async t=>{
  const root=fixture(t), a=call(root,'alpha','assign_task',{to:'beta',goal:'Finish once',request_id:'finished'});
  deliverOutbox(root);
  call(root,'beta','report_assignment',{id:a.id,status:'completed',result:'Saved before worker death',request_id:'done'});
  const text='Grüße 🌍', buffer=Buffer.from(JSON.stringify({id:'unicode',kind:'user',text})+'\n');
  const cut=buffer.indexOf(Buffer.from('🌍'))+2;
  const file=join(root,'beta','.metor/inbox.jsonl');appendFileSync(file,buffer.subarray(0,cut));
  const p=child(root,`import {createCore} from '${lib}metor-host-core.mjs'; import {writeFileSync} from 'node:fs';
    const core=createCore('beta');core.ready();for await(const turn of core.turns()) {
      writeFileSync(process.env.METOR_BOTS_DIR+'/observed.json',JSON.stringify(turn));core.finishTurn();process.exit(0);
    }`);
  await pause(650);appendFileSync(file,buffer.subarray(cut));
  const outcome=await p.done;assert.equal(outcome.code,0,outcome.output);
  const received=JSON.parse(readFileSync(join(root,'observed.json')));
  assert.equal(received.id,'unicode');assert.equal(received.text,text);
});
