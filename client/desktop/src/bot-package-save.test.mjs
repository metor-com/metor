import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { saveBotPackage } from './bot-package-save.mjs';
test('save returns success only after writing; cancel retains the dialog; errors propagate', async t => {
 const root=mkdtempSync(join(tmpdir(),'metor-save-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const bytes=Uint8Array.from([0x50,0x4b,3,4,42]).buffer;
 assert.equal(await saveBotPackage('bot.metor-bot.zip',bytes,async()=>({canceled:true})),false);
 assert.deepEqual(readdirSync(root),[]);
 const path=join(root,'bot.zip');
 assert.equal(await saveBotPackage('bot.metor-bot.zip',bytes,async options=>{assert.equal(options.defaultPath,'bot.metor-bot.zip');return {filePath:path};}),true);
 assert.deepEqual(readFileSync(path),Buffer.from(bytes));
 await assert.rejects(saveBotPackage('bot.metor-bot.zip',bytes,async()=>({filePath:join(root,'missing','bot.zip')})));
 await assert.rejects(saveBotPackage('bad',new ArrayBuffer(4),async()=>{throw Error('Picker must not open');}),/Invalid ZIP/);
});
