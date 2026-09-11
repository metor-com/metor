// Opt-in integration test: creates metor-ram-test and five isolated volumes.
// Leaves the test Space running for smoke/UI checks; cleanup commands are printed below.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { createResourceManager } from '../client/desktop/src/space-resources.mjs';
const rt=(...args)=>execFileSync('container',args,{encoding:'utf8',stdio:['ignore','pipe','pipe']});
const name='metor-ram-test', dirs=['/workspace','/home/box/.claude','/home/box/.codex','/home/box/.gemini','/home/box/.copilot'];
const vols=dirs.flatMap((dir,i)=>['-v',`${name}-${i}:${dir}`]);
for(let i=0;i<5;i++) {try { rt('volume','inspect',`${name}-${i}`); } catch { rt('volume','create',`${name}-${i}`); }}
rt('run','--rm','--user','0:0','--entrypoint','/bin/sh',...vols,'metor-box:resize-test','-c',`chown 1000:1000 ${dirs.join(' ')}`);
rt('run','-d','--name',name,'--memory','2g','--cpus','2','--shm-size','1g','-p','127.0.0.1:6077:6010',...vols,'metor-box:resize-test');
const ready=async()=>{for(let n=0;n<60;n++){try{const r=await fetch('http://127.0.0.1:6077/bots/api/version');if(r.ok)return true}catch{}await new Promise(r=>setTimeout(r,1000))}return false};
assert.ok(await ready());
rt('exec',name,'sh','-c','printf retained > /workspace/ram-check.txt');
const link=rt('exec',name,'metor','auth','link','--plain').match(/token=([\w-]+)/)[1];
const auth=await fetch('http://127.0.0.1:6077/bots/api/auth/redeem',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token:link})});
const credentials=await auth.json();
const config=mkdtempSync(join(tmpdir(),'metor-real-ram-'));
try {
 const manager=createResourceManager({env:{...process.env,METOR_BOX_CONTAINER:name,METOR_MEMORY:'',XDG_CONFIG_HOME:config}});
 const before=await manager.read('container','http://127.0.0.1:6077');assert.equal(before.currentBytes,2*1024**3);
 await manager.apply('container','http://127.0.0.1:6077',2304,{ready,progress:console.log});
 const after=await manager.read('container','http://127.0.0.1:6077');assert.equal(after.savedMiB,2304);assert.equal(after.currentBytes,2304*1024**2);
 assert.equal(rt('exec',name,'cat','/workspace/ram-check.txt'),'retained');
 const check=await fetch('http://127.0.0.1:6077/bots/api/space',{headers:{authorization:`Bearer ${credentials.secret}`}});assert.equal(check.status,200);
 await manager.apply('container','http://127.0.0.1:6077',2048,{ready,progress:console.log});
 const reduced=await manager.read('container','http://127.0.0.1:6077');assert.equal(reduced.currentBytes,2048*1024**2);assert.equal(reduced.savedMiB,2048);
 assert.equal(rt('exec',name,'cat','/workspace/ram-check.txt'),'retained');
 assert.equal((await fetch('http://127.0.0.1:6077/bots/api/space',{headers:{authorization:`Bearer ${credentials.secret}`}})).status,200);
 console.log('PASS: real Apple RAM increase and reduction, persistence, data and device session retained');
} finally {rmSync(config,{recursive:true,force:true})}

console.log("Cleanup: container stop metor-ram-test; container delete metor-ram-test; container volume delete metor-ram-test-{0,1,2,3,4}");
