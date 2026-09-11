// Real gateway/UI with a simulated desktop host bridge; never resizes the personal Space.
import { chromium } from '/usr/local/lib/node_modules/@playwright/mcp/node_modules/playwright/index.mjs';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage'],headless:true});
try {
 const page=await browser.newPage({viewport:{width:1100,height:850}});page.setDefaultTimeout(15000);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{
  const c={id:'local',name:'Test Space',origin:location.origin,signedIn:true,reachable:true,local:true};
  window.applied=[];
  const state={runtime:'container',currentBytes:2*1024**3,hostBytes:16*1024**3,maxBytes:8*1024**3,reserveBytes:3*1024**3,otherBytes:5*1024**3,savedMiB:null,override:null,allowReduction:true,restartRequired:true};
  window.metor={gateway:c,gateways:async()=>[c],notify(){},onOpenBot(){},local:{resources:async()=>({...state}),setMemory:async(id,mib)=>{window.applied.push({id,mib});state.currentBytes=mib*1024**2;state.savedMiB=mib;return {ok:true}}}};
 });
 const link=execFileSync('metor',['auth','link','--plain'],{encoding:'utf8'}).match(/http[^\s]+claim\?token=[A-Za-z0-9_-]+/)[0];
 await page.goto(link);await page.goto('http://127.0.0.1:6010/bots/#/smoke');
 await page.getByRole('button',{name:'Menu',exact:true}).click();await page.getByRole('button',{name:'Manage Space',exact:true}).click();
 await page.getByRole('button',{name:/^Resources & updates/}).click();
 const input=page.getByLabel('New total RAM (GiB)');await input.waitFor();await input.fill('3.25');
 page.once('dialog',d=>d.dismiss());await page.getByRole('button',{name:'Apply and restart',exact:true}).click();assert.deepEqual(await page.evaluate(()=>window.applied),[]);
 page.once('dialog',d=>{assert.match(d.message(),/interrupted/);d.accept()});await page.getByRole('button',{name:'Apply and restart',exact:true}).click();
 await page.getByText('RAM allocation applied and saved.',{exact:true}).waitFor();
 assert.deepEqual(await page.evaluate(()=>window.applied),[{id:'local',mib:3328}]);
 await page.getByText('Currently 3.25 GiB',{exact:true}).waitFor();
 await input.fill('2');
 await page.route('**/bots/api/memory',route=>route.fulfill({json:{available:true,usedBytes:3*1024**3}}));
 page.once('dialog',d=>{assert.match(d.message(),/exceeds the new limit/);d.dismiss()});
 await page.getByRole('button',{name:'Apply and restart',exact:true}).click();assert.equal((await page.evaluate(()=>window.applied)).length,1);
 page.once('dialog',d=>{assert.match(d.message(),/exceeds the new limit/);d.accept()});
 await page.getByRole('button',{name:'Apply and restart',exact:true}).click();await page.getByText('Currently 2 GiB',{exact:true}).waitFor();
 assert.deepEqual(await page.evaluate(()=>window.applied),[{id:'local',mib:3328},{id:'local',mib:2048}]);
 await input.fill('0.75');assert.ok(await page.getByRole('button',{name:'Apply and restart',exact:true}).isDisabled());
 await page.screenshot({path:'/tmp/metor-ram-settings.png'});
 await page.setViewportSize({width:390,height:844});
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.screenshot({path:'/tmp/metor-ram-settings-mobile.png'});
 assert.deepEqual(errors,[]);console.log('PASS: RAM form, explicit restart confirmation, cancellation, saved allocation and mobile layout');
} finally {await browser.close()}
