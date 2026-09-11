// Isolated Space only: occupy admission without allocating RAM, then release it.
import { chromium } from '/usr/local/lib/node_modules/@playwright/mcp/node_modules/playwright/index.mjs';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import assert from 'node:assert/strict';
const name='resource-wait-probe', file='/workspace/bots/.memory/admission.json';
execFileSync('metor',['bot','create',name,'--harness','codex']);
mkdirSync('/workspace/bots/.memory',{recursive:true});
const changeLease=lease=>{let state;try{state=JSON.parse(readFileSync(file))}catch{state={queue:[]}}state.lease=lease;writeFileSync(file+'.test',JSON.stringify(state));renameSync(file+'.test',file)};
changeLease({pid:process.pid,name:'test-admission',until:Date.now()+60000});
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage'],headless:true});
try {
 const page=await browser.newPage({viewport:{width:500,height:800}});page.setDefaultTimeout(25000);
 const link=execFileSync('metor',['auth','link','--plain'],{encoding:'utf8'}).match(/http[^\s]+claim\?token=[A-Za-z0-9_-]+/)[0];await page.goto(link);
 const {path}=await(await page.request.get(`http://127.0.0.1:6010/bots/api/agents/${name}/watch-url`)).json();
 const response=await page.goto('http://127.0.0.1:6010'+path);assert.equal(response.status(),503);assert.equal(response.headers()['refresh'],'2');
 await page.getByRole('heading',{name:'Waiting for RAM'}).waitFor();await page.screenshot({path:'/tmp/metor-resource-wait.png'});
 const bot=(await(await page.request.get('http://127.0.0.1:6010/bots/api/agents')).json()).find(x=>x.name===name);assert.equal(bot.waitingForMemory.kind,'desktop');
 changeLease(null);
 await page.locator('#noVNC_container').waitFor({state:'attached'});
 const events=JSON.parse(execFileSync('node',['--input-type=module','-e',`import {readEvents} from '/usr/local/lib/metor/metor-events.mjs';console.log(JSON.stringify(readEvents('/workspace/bots/${name}/.metor')))`],{encoding:'utf8'}));
 assert.ok(events.some(e=>e.type==='desktop.memory_waiting'));assert.ok(events.some(e=>e.type==='desktop.memory_resumed'));
 console.log('PASS: gateway waiting page, resource status, live automatic retry and logged recovery');
} finally {changeLease(null);await browser.close();execFileSync('metor',['bot','stop',name]);}
