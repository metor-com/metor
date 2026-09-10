import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from '../bin/metor-host-codex.mjs';

test('Codex sends the selected effort on turns and on a resumed conversation', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'metor-effort-'));
  const previousPath = process.env.PATH;
  writeFileSync(join(dir, 'codex'), `#!${process.execPath}
    const {createInterface} = require('node:readline');
    const {appendFileSync} = require('node:fs');
    const send = (m) => process.stdout.write(JSON.stringify(m) + '\\n');
    createInterface({input: process.stdin}).on('line', (line) => {
      const m = JSON.parse(line); if (m.id === undefined) return;
      appendFileSync('requests.jsonl', line + '\\n');
      let result = {};
      if (m.method.startsWith('thread/')) result = {thread: {id: 'same-thread'}};
      if (m.method === 'model/list') result = {data: [{id: 'wire-model', model: 'model', displayName: 'Model',
        supportedReasoningEfforts: [{reasoningEffort:'low', description:'Faster'}, {reasoningEffort:'high', description:'Thorough'}], defaultReasoningEffort:'low'}]};
      if (m.method === 'turn/start') result = {turn: {id: 'turn'}};
      send({id: m.id, result});
      if (m.method === 'turn/start') setTimeout(() => send({method:'turn/completed', params:{}}), 10);
    });
  `, { mode: 0o755 });
  process.env.PATH = `${dir}:${previousPath}`;
  const state = {sessionId:'same-thread'}, bot = {name:'probe', model:'model', reasoningEffort:'high'};
  let models;
  try {
    for (let restart = 0; restart < 2; restart++) {
      const cleanups = [];
      const core = {
        dir, name:'probe', bot, state,
        saveState(patch) { Object.assign(state, patch); },
        setCapabilities(commands, list) { models = list; },
        setModelHandler() {}, setInterruptHandler() {}, ready() {}, log() {}, partialClear() {}, finishTurn() {},
        onShutdown(fn) { cleanups.push(fn); }, fail(e) { throw e; },
        async *turns() { yield {text: 'Test'}; },
      };
      try { await run(core); } finally { for (const fn of cleanups) fn(); }
    }
    assert.deepEqual(models[0].reasoningEfforts.map((e) => e.id), ['low', 'high']);
    assert.equal(models[0].defaultReasoningEffort, 'low');
    const requests = readFileSync(join(dir, 'requests.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    assert.equal(requests.filter((r) => r.method === 'thread/resume').length, 2);
    const turns = requests.filter((r) => r.method === 'turn/start');
    assert.equal(turns.length, 2);
    for (const turn of turns) {
      assert.equal(turn.params.threadId, 'same-thread');
      assert.equal(turn.params.model, 'model');
      assert.equal(turn.params.effort, 'high');
    }
  } finally { process.env.PATH = previousPath; rmSync(dir, {recursive:true, force:true}); }
});

test('a failed resume cannot replace a conversation that has received a turn', async () => {
  const dir=mkdtempSync(join(tmpdir(),'metor-resume-')), previousPath=process.env.PATH;
  writeFileSync(join(dir,'codex'), `#!${process.execPath}
    const {createInterface}=require('node:readline');
    const {appendFileSync}=require('node:fs');
    createInterface({input:process.stdin}).on('line',line=>{
      const m=JSON.parse(line); if(m.id===undefined)return;
      appendFileSync('requests.jsonl',line+'\\n');
      process.stdout.write(JSON.stringify({id:m.id,...(m.method==='thread/resume'?{error:{message:'saved rollout unavailable'}}:{result:{}})})+'\\n');
    });
  `,{mode:0o755});
  process.env.PATH=`${dir}:${previousPath}`;
  const cleanups=[], state={sessionId:'saved-thread',conversationStarted:true};
  const core={dir,name:'probe',bot:{},state,log(){},onShutdown(fn){cleanups.push(fn)},fail(e){throw e}};
  try{
    await assert.rejects(run(core),/Could not resume the saved conversation/);
    assert.equal(state.sessionId,'saved-thread');
    assert.ok(!readFileSync(join(dir,'requests.jsonl'),'utf8').includes('thread/start'));
  }finally{for(const fn of cleanups)fn();process.env.PATH=previousPath;rmSync(dir,{recursive:true,force:true})}
});
