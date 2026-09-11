import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appleCreateArgs, validateAllocation, createResourceManager, settingsPath, MiB } from '../src/space-resources.mjs';
const fixture = () => ({ id: 'test-space', configuration: {
 image:{reference:'metor-box:test',descriptor:{digest:'sha256:abc'}},resources:{memoryInBytes:2048*MiB,cpus:2},shmSize:1024*MiB,
 platform:{os:'linux',architecture:'arm64'},runtimeHandler:'container-runtime-linux',
 initProcess:{executable:'tini',arguments:['--','metor','supervise'],environment:['METOR_AUTH=','CUSTOM=value with spaces'],user:{raw:{userString:'box'}},workingDirectory:'/workspace'},
 mounts:['/workspace','/home/box/.claude','/home/box/.codex','/home/box/.gemini','/home/box/.copilot'].map((destination,i)=>({destination,type:{volume:{name:`test-volume-${i}`}},options:[]})),
 networks:[{network:'default'}],publishedPorts:[{containerPort:6010,hostPort:6077,hostAddress:'127.0.0.1',proto:'tcp',count:1}],
 },status:{state:'running'}});
test('increase validation and lossless essentials for Apple recreation', () => {
 const f=fixture(),args=appleCreateArgs(f,3072*MiB);
 assert.ok(args.includes('metor-box:test'));assert.ok(args.includes('CUSTOM=value with spaces'));
 for(let i=0;i<5;i++) assert.ok(args.some(s=>s.startsWith(`test-volume-${i}:`)));
 assert.ok(args.includes('127.0.0.1:6077:6010/tcp'));
 for(const n of [0,-1,2048,2049,NaN,Infinity,8192]) assert.throws(()=>validateAllocation(n,2048*MiB,4096*MiB));
 validateAllocation(3072,2048*MiB,4096*MiB);
 validateAllocation(1024,2048*MiB,4096*MiB,true);
 assert.throws(()=>validateAllocation(1024,2048*MiB,4096*MiB));
 f.configuration.mounts.pop();assert.throws(()=>appleCreateArgs(f,3072*MiB));
});
test('apply saves only after readiness, rolls back failure, checks target and override before stop', async () => {
 const dir=await mkdtemp(join(tmpdir(),'metor-resources-'));
 try {
  const env={XDG_CONFIG_HOME:dir,METOR_BOX_CONTAINER:'test-space'}, calls=[];
  let info=fixture(),ready=true;
  const run=async(rt,args)=>{calls.push(args);
   if(args[0]==='image') return JSON.stringify([{configuration:{descriptor:{digest:'sha256:abc'}}}]);
   if(args[0]==='inspect') return JSON.stringify([info]);
   if(args[0]==='list') return JSON.stringify([info]);
   if(args[0]==='create') info.configuration.resources.memoryInBytes=Number(args[args.indexOf('--memory')+1].slice(0,-1))*MiB;
   return '';
  };
  const manager=createResourceManager({env,run,hostTotal:()=>16*1024*MiB,hostFree:()=>8*1024*MiB});
  await assert.rejects(manager.apply('container','http://127.0.0.1:6078',3072),/does not match/);assert.ok(!calls.some(c=>c[0]==='stop'));
  await manager.apply('container','http://127.0.0.1:6077',3072,{ready:async()=>ready});
  assert.equal((await readFile(settingsPath(env,'container','test-space'),'utf8')).trim(),'3072');
  ready=false;await assert.rejects(manager.apply('container','http://127.0.0.1:6077',4096,{ready:async()=>ready}),/previous allocation was restored/);
  assert.equal(info.configuration.resources.memoryInBytes,3072*MiB);
  assert.equal((await readFile(settingsPath(env,'container','test-space'),'utf8')).trim(),'3072');
  ready=true;await manager.apply('container','http://127.0.0.1:6077',2048,{ready:async()=>ready});
  assert.equal(info.configuration.resources.memoryInBytes,2048*MiB);
  assert.equal((await readFile(settingsPath(env,'container','test-space'),'utf8')).trim(),'2048');
  calls.length=0;env.METOR_MEMORY='6g';await assert.rejects(manager.apply('container','http://127.0.0.1:6077',4096),/overrides/);assert.ok(!calls.some(c=>c[0]==='stop'));
 } finally {await rm(dir,{recursive:true,force:true})}
});
