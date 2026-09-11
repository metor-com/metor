import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { memorySnapshot, createMemoryGuard } from '../bin/metor-memory.mjs';
const MiB = 1024 ** 2;
const fixture = extra => ({ '/proc/meminfo': 'MemTotal: 8388608 kB\nMemAvailable: 6291456 kB\n', ...extra });
const sample = files => memorySnapshot({ os: 'linux', readText: file => files[file] ?? null });
test('RAM readings respect physical available memory, cgroup v2 and visible ancestor headroom', () => {
  let files = fixture({ '/sys/fs/cgroup/memory.max': String(2048*MiB), '/sys/fs/cgroup/memory.current': String(1600*MiB) });
  let m = sample(files); assert.equal(m.totalBytes,2048*MiB); assert.equal(m.availableBytes,448*MiB); assert.equal(m.low,true);
  files['/sys/fs/cgroup/memory.stat'] = `inactive_file ${800*MiB}\n`;
  assert.equal(sample(files).availableBytes,1248*MiB); assert.equal(sample(files).low,false);
  files = fixture({ '/proc/self/cgroup':'0::/parent/child', '/proc/self/mountinfo':'1 0 0:1 / /sys/fs/cgroup rw - cgroup2 cgroup rw',
    '/sys/fs/cgroup/parent/child/memory.max':String(2048*MiB), '/sys/fs/cgroup/parent/child/memory.current':String(256*MiB),
    '/sys/fs/cgroup/parent/memory.max':String(4096*MiB), '/sys/fs/cgroup/parent/memory.current':String(3900*MiB) });
  m=sample(files); assert.equal(m.totalBytes,2048*MiB); assert.equal(m.availableBytes,196*MiB);
  assert.equal(m.requiredBytes,768*MiB);
});
test('RAM readings support cgroup v1, unlimited limits, zero headroom and unavailable measurements', () => {
  let files=fixture({ '/sys/fs/cgroup/memory/memory.limit_in_bytes':String(1024*MiB), '/sys/fs/cgroup/memory/memory.usage_in_bytes':String(1100*MiB) });
  assert.equal(sample(files).availableBytes,0);
  files=fixture({ '/sys/fs/cgroup/memory.max':'max' }); assert.equal(sample(files).availableBytes,6144*MiB);
  assert.equal(sample({}).available,false);
  assert.equal(sample(fixture({'/sys/fs/cgroup/memory.max':String(1024*MiB)})).available,false);
});
test('admission preserves FIFO order, checks fresh memory and recovers dead startup owners', () => {
  const root=mkdtempSync(join(tmpdir(),'metor-memory-')); let memory={available:true,low:true};
  const guard=createMemoryGuard({root,sample:()=>memory});
  try {
    assert.equal(guard.request('first').reason,'low_memory');
    assert.equal(guard.request('second').reason,'low_memory');
    assert.equal(guard.snapshot().waiting.length,2);
    memory={available:true,low:false};
    assert.equal(guard.request('second').reason,'startup_queue');
    assert.equal(guard.request('first').admitted,true);
    assert.equal(guard.request('second').admitted,false);
    guard.release('first'); memory={available:false};
    assert.equal(guard.request('second').reason,'memory_unavailable');
    memory={available:true,low:false}; assert.equal(guard.request('second').admitted,true);
    const file=join(root,'admission.json'), state=JSON.parse(readFileSync(file));
    state.lease.boot='previous-boot'; state.lease.start='not-this-process'; writeFileSync(file,JSON.stringify(state));
    assert.equal(guard.request('third').admitted,true);
    guard.release('third');
    assert.equal(guard.snapshot().starting,null);
  } finally {rmSync(root,{recursive:true,force:true})}
});
test('simultaneous processes cannot reserve the same startup headroom twice', async () => {
  const root=mkdtempSync(join(tmpdir(),'metor-memory-')), children=[];
  const module=new URL('../bin/metor-memory.mjs',import.meta.url).href;
  try {
    const results=await Promise.all(Array.from({length:4},(_,i)=>new Promise((resolve,reject)=>{
      const child=spawn(process.execPath,['--input-type=module','-e',`import {createMemoryGuard} from ${JSON.stringify(module)}; const guard=createMemoryGuard({root:${JSON.stringify(root)},sample:()=>({available:true,low:false})}); process.send(guard.request('bot-${i}')); setInterval(()=>{},1000);`],{stdio:['ignore','ignore','ignore','ipc']});
      children.push(child); child.once('error',reject); child.once('message',resolve);
    })));
    assert.equal(results.filter(r=>r.admitted).length,1);
  } finally { await Promise.all(children.map(async c=>{const done=once(c,'exit');c.kill();await done})); rmSync(root,{recursive:true,force:true}); }
});

test('resource requests survive callers, remain separate by kind and share runtime admission', () => {
  const root=mkdtempSync(join(tmpdir(),'metor-resource-queue-')), dir=join(root,'probe');
  mkdirSync(join(dir,'.desktop'),{recursive:true});
  writeFileSync(join(dir,'bot.json'),JSON.stringify({name:'probe',harness:'codex',autostart:true}));
  writeFileSync(join(dir,'.desktop/demand.json'),JSON.stringify({browser:true,desktop:true}));
  const module=new URL('../bin/metor-memory.mjs',import.meta.url).href;
  const run=body=>execFileSync(process.execPath,['--input-type=module','-e',`import assert from 'node:assert/strict';import {createMemoryGuard} from ${JSON.stringify(module)};let availableBytes=0;const guard=createMemoryGuard({sample:()=>({available:true,availableBytes,reserveBytes:256*1024**2,low:availableBytes<768*1024**2})});${body}`],{env:{...process.env,METOR_BOTS_DIR:root},stdio:'pipe'});
  try {
    run(`guard.request('probe',{kind:'desktop',startBytes:640*1024**2});guard.request('probe',{kind:'browser',startBytes:512*1024**2});`);
    run(`assert.equal(guard.snapshot().waiting.length,2);guard.release('probe','browser');assert.deepEqual(guard.snapshot().waiting.map(x=>x.kind),['desktop']);availableBytes=2*1024**3;assert.equal(guard.request('runtime-bot').reason,'startup_queue');assert.equal(guard.request('probe',{kind:'desktop',startBytes:640*1024**2}).admitted,true);guard.release('probe','desktop',2000);assert.equal(guard.request('runtime-bot').admitted,false);`);
    const file=join(root,'.memory/admission.json'),state=JSON.parse(readFileSync(file));state.lease.until=Date.now()-1;writeFileSync(file,JSON.stringify(state));
    run(`availableBytes=2*1024**3;assert.equal(guard.request('runtime-bot').admitted,true);guard.release('runtime-bot');guard.request('probe',{kind:'desktop',startBytes:3*1024**3});`);
    writeFileSync(join(dir,'bot.json'),JSON.stringify({name:'probe',harness:'codex',autostart:false}));
    run(`assert.equal(guard.snapshot().waiting.length,0);availableBytes=2*1024**3;assert.equal(guard.request('other').admitted,true);`);
  } finally {rmSync(root,{recursive:true,force:true})}
});
