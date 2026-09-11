// Opt-in Apple-container upgrade test. Uses only isolated containers, volumes and host settings.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
const name='metor-release-upgrade-test', oldImage='ghcr.io/metor-com/metor-box:0.3.0';
const newImage=process.env.METOR_RELEASE_TEST_IMAGE || 'metor-box:resize-test';
const currentVersion=readFileSync('VERSION','utf8').trim(), origin='http://127.0.0.1:6088';
const cli=execFileSync('/bin/sh',['-c','command -v container'],{encoding:'utf8'}).trim();
const rt=(...args)=>execFileSync(cli,args,{encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:8*1024**2});
const config=mkdtempSync(join(tmpdir(),'metor-upgrade-'));
const keys=['workspace','claude','codex','gemini','copilot'], destinations=['/workspace',...keys.slice(1).map(k=>`/home/box/.${k}`)];
const volumes=keys.flatMap((k,i)=>['-v',`${name}-${k}:${destinations[i]}`]);
const ready=async version=>{for(let n=0;n<90;n++){try{const r=await fetch(origin+'/bots/api/version');if(r.ok&&(await r.json()).version===version)return;}catch{}await new Promise(r=>setTimeout(r,1000));}throw new Error(`Space did not become ready at ${version}`)};
let created=false;const madeVolumes=[];
try {
  let exists=false;try{rt('inspect',name);exists=true}catch{}assert.equal(exists,false,'Remove the previous isolated test container before running again');
  for(const k of keys){rt('volume','create',`${name}-${k}`);madeVolumes.push(`${name}-${k}`)}
  rt('run','--rm','--user','0:0','--entrypoint','/bin/sh',...volumes,oldImage,'-c',`chown 1000:1000 ${destinations.join(' ')}`);
  rt('run','-d','--name',name,'--memory','2g','--cpus','2','-p','127.0.0.1:6088:6010',...volumes,oldImage);created=true;
  await ready('0.3.0');
  rt('exec',name,'metor','bot','create','upgrade-probe','--role','Release upgrade fixture','--no-start');
  const marker='release-upgrade-retained';
  const seed=`const fs=require('fs');fs.mkdirSync('/workspace/bots/upgrade-probe/.metor',{recursive:true});fs.writeFileSync('/workspace/bots/upgrade-probe/retained.txt',${JSON.stringify(marker)});fs.writeFileSync('/workspace/bots/upgrade-probe/.metor/chat.jsonl',JSON.stringify({v:2,id:'upgrade-message',ts:new Date().toISOString(),role:'user',kind:'text',text:${JSON.stringify(marker)}})+'\\n');for(const k of ['claude','codex','gemini','copilot'])fs.writeFileSync('/home/box/.'+k+'/release-marker',${JSON.stringify(marker)});`;
  rt('exec',name,'node','-e',seed);
  const savedChat=rt('exec',name,'cat','/workspace/bots/upgrade-probe/.metor/chat.jsonl');
  const token=rt('exec',name,'metor','auth','link','--plain').match(/token=([\w-]+)/)[1];
  const auth=await fetch(origin+'/bots/api/auth/redeem',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token})});assert.equal(auth.status,200);
  const {secret}=await auth.json();const headers={authorization:`Bearer ${secret}`};
  const resourceDir=join(config,'metor/resources/container');mkdirSync(resourceDir,{recursive:true});writeFileSync(join(resourceDir,`${name}.memory-mib`),'2560\n');
  // The production wrapper uses standard volume names. Only the test shim redirects these
  // names to this test's volumes; every other command is executed by the real runtime.
  const bin=join(config,'bin');mkdirSync(bin);
  writeFileSync(join(bin,'container'),`#!/usr/bin/env node\nconst {spawnSync}=require('node:child_process');const keys=${JSON.stringify(keys)};const args=process.argv.slice(2).map(a=>{for(const k of keys){if(a==='metor-'+k||a.startsWith('metor-'+k+':'))return a.replace('metor-'+k,${JSON.stringify(name)}+'-'+k)}return a});const r=spawnSync(${JSON.stringify(cli)},args,{stdio:'inherit'});process.exit(r.status??1);\n`,{mode:0o755});
  const env={...process.env,PATH:bin+':'+process.env.PATH,XDG_CONFIG_HOME:config,METOR_RUNTIME:'container',METOR_BOX_CONTAINER:name,METOR_BOX_IMAGE:newImage,METOR_MEMORY:'',METOR_CPUS:'2',METOR_PORT:'6088'};
  const wrapper=resolve('backend/harness/bin/metor');
  execFileSync(wrapper,['box','down'],{env,stdio:'pipe'});execFileSync(wrapper,['box','up'],{env,stdio:'pipe'});
  await ready(currentVersion);
  const inspect=JSON.parse(rt('inspect',name))[0];assert.equal(inspect.configuration.resources.memoryInBytes,2560*1024**2);
  const bots=await(await fetch(origin+'/bots/api/agents',{headers})).json();assert.ok(bots.some(b=>b.name==='upgrade-probe'));
  assert.equal(rt('exec',name,'cat','/workspace/bots/upgrade-probe/.metor/chat.jsonl'),savedChat);
  assert.equal(await(await fetch(origin+'/bots/api/agents/upgrade-probe/chat/file?path=retained.txt',{headers})).text(),marker);
  for(const k of keys.slice(1))assert.equal(rt('exec',name,'cat',`/home/box/.${k}/release-marker`),marker);
  assert.equal((await fetch(origin+'/bots/api/memory',{headers})).status,200);
  // A second ordinary restart must still use the saved allocation and same device session.
  execFileSync(wrapper,['box','down'],{env,stdio:'pipe'});execFileSync(wrapper,['box','up'],{env,stdio:'pipe'});await ready(currentVersion);
  assert.equal(JSON.parse(rt('inspect',name))[0].configuration.resources.memoryInBytes,2560*1024**2);
  assert.equal((await fetch(origin+'/bots/api/agents',{headers})).status,200);
  console.log(`PASS: 0.3.0 → ${currentVersion}, bots, chat, files, all sign-in volumes, paired device and saved RAM survive update and ordinary restart`);
} finally {
  if(created){try{rt('stop',name)}catch{}try{rt('delete',name)}catch{}}
  for(const volume of madeVolumes){try{rt('volume','delete',volume)}catch{}}
  rmSync(config,{recursive:true,force:true});
}
