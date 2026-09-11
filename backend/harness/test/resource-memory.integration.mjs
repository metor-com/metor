// Run inside an isolated image. No runtime or inference requests; deterministic RAM readings.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const root=mkdtempSync(join(tmpdir(),'metor-resource-'));
process.env.METOR_BOTS_DIR=root;
const {createMemoryGuard}=await import('/usr/local/lib/metor/metor-memory.mjs');
const {startResource,repairResources,resourceAlive,resourceWaiting,desktopStop}=await import('/usr/local/lib/metor/metor-desktop.mjs');
const {readBot}=await import('/usr/local/lib/metor/metor-store.mjs');
const MiB=1024**2, name='resource-probe', dir=join(root,name);
mkdirSync(dir);writeFileSync(join(dir,'bot.json'),JSON.stringify({name,harness:'codex',display:43,watchToken:'test-watch-token',autostart:true}));
const b=readBot(name);let availableBytes=300*MiB;
const memory=createMemoryGuard({root:join(root,'.memory'),sample:()=>({available:true,totalBytes:2048*MiB,availableBytes,reserveBytes:256*MiB,startBytes:512*MiB,low:availableBytes<768*MiB})});
try {
 assert.equal(startResource(b,'desktop',{memory}),false);
 assert.equal(resourceAlive(b,'browser'),false);assert.equal(resourceAlive(b,'desktop'),false);
 assert.equal(resourceWaiting(b).desktop.reason,'low_memory');
 assert.equal(memory.snapshot().waiting[0].kind,'desktop');
 const before=readFileSync(join(dir,'.metor/events.jsonl'),'utf8');
 assert.equal(startResource(b,'desktop',{memory}),false);assert.equal(readFileSync(join(dir,'.metor/events.jsonl'),'utf8'),before);
 availableBytes=1400*MiB;repairResources(b,{memory});
 assert.equal(resourceAlive(b,'desktop'),true);assert.deepEqual(resourceWaiting(b),{});
 assert.equal(memory.snapshot().waiting.length,0);
 const pid=readFileSync(join(dir,'.desktop/chromium.pid'),'utf8');
 availableBytes=0;assert.equal(startResource(b,'desktop',{memory}),true);assert.equal(readFileSync(join(dir,'.desktop/chromium.pid'),'utf8'),pid);
 // Terminal is separately admitted; Stop clears both the demand and durable queue.
 assert.equal(startResource(b,'terminal',{memory}),false);
 desktopStop(b);assert.equal(memory.snapshot().waiting.length,0);assert.equal(existsSync(join(dir,'.desktop/memory.json')),false);
 assert.match(readFileSync(join(dir,'.metor/events.jsonl'),'utf8'),/desktop.memory_resumed/);
 assert.match(readFileSync(join(dir,'.metor/events.jsonl'),'utf8'),/terminal.memory_cancelled/);
 console.log('PASS: no GUI starts under pressure, automatic repair, deduplicated events, existing browser retained and Stop cancels waiting');
} finally {desktopStop(b);rmSync(root,{recursive:true,force:true})}
