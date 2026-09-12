// Run with stdin inside an isolated freshly-built Space; no model login is required.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, symlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const {collaborationCall:call,deliverOutbox}=await import('/usr/local/lib/metor/metor-collaboration.mjs');
const root='/workspace/bots', base='http://127.0.0.1:6010/bots';
for(const [name,harness] of [['writer','claude-stream'],['reviewer','codex']]) {
  mkdirSync(`${root}/${name}/.metor`,{recursive:true});
  writeFileSync(`${root}/${name}/bot.json`,JSON.stringify({name,title:name,role:'Integration test',harness,autostart:false,display:name==='writer'?10:11,createdAt:new Date().toISOString()}));
}
mkdirSync('/workspace/shared',{recursive:true});writeFileSync('/workspace/shared/review.md','Review ready');
writeFileSync('/workspace/shared/report.html','<h1>Report</h1>');symlinkSync('/etc/passwd','/workspace/shared/escape');
const a=call(root,'writer','assign_task',{to:'reviewer',goal:'Review the draft',request_id:'api-task'});
call(root,'reviewer','report_assignment',{id:a.id,status:'completed',result:'Review complete',files:['review.md'],request_id:'api-result'});
const link=execFileSync('metor',['auth','link','--plain'],{encoding:'utf8'}).match(/http[^\s]+claim\?token=[A-Za-z0-9_-]+/)[0];
const claim=await fetch(link,{redirect:'manual'}),cookie=claim.headers.get('set-cookie').split(';')[0];
const url=base+'/api/agents/writer/chat/file?shared=1&path=';
assert.equal((await fetch(url+'review.md')).status,401);
assert.equal(await (await fetch(url+'review.md',{headers:{cookie}})).text(),'Review ready');
assert.equal((await fetch(url+'report.html',{headers:{cookie}})).headers.get('content-security-policy'),'sandbox allow-scripts');
for(const path of ['../bots/writer/bot.json','/etc/passwd','escape','.private'])assert.equal((await fetch(url+encodeURIComponent(path),{headers:{cookie}})).status,404);
const controller=new AbortController();
const response=await fetch(base+'/api/events?topics=notify',{headers:{cookie},signal:controller.signal});
assert.equal(response.status,200);
let events='';const read=(async()=>{try{for await(const chunk of response.body)events+=Buffer.from(chunk).toString()}catch(e){if(e.name!=='AbortError')throw e}})();
deliverOutbox(root);
for(let i=0;i<100&&!events.includes('assignment update');i++)await new Promise(r=>setTimeout(r,100));
assert.ok(events.includes('assignment update'),events);
deliverOutbox(root);await new Promise(r=>setTimeout(r,2200));
assert.equal(events.split('assignment update').length-1,1);
controller.abort();await read;
const history=await (await fetch(base+'/api/agents/writer/chat/history',{headers:{cookie}})).json();
assert.ok(JSON.stringify(history).includes('review.md'));
console.log('PASS: authenticated shared-file links, path protections, durable collaboration history and one native/client notification');
