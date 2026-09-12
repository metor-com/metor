// Exercise the actual runtime registry and the stdio server each adapter receives.
// No paid account or provider network access is used by this test.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { HARNESSES } from '../bin/metor-harness.mjs';
import { readHistory } from '../bin/metor-chat-stream.mjs';
const lib=fileURLToPath(new URL('../bin/',import.meta.url));
const templates=fileURLToPath(new URL('../templates/',import.meta.url));
test('Claude, Gemini and Copilot configurations bind the same metor tools to their own bot; Codex uses final command overrides',()=>{
  const root=mkdtempSync(join(tmpdir(),'metor-mcp-adapters-')); const schemas=[];
  try {
    for(const [name,harness] of [['alpha','claude-stream'],['beta','gemini'],['gamma','copilot'],['delta','codex']]) {
      const dir=join(root,name);mkdirSync(dir,{recursive:true});writeFileSync(join(dir,'bot.json'),JSON.stringify({name,harness,autostart:true,display:1}));
    }
    for(const [name,harness,path] of [['alpha','claude-stream','mcp.json'],['beta','gemini','.gemini/settings.json'],['gamma','copilot','.copilot/mcp-config.json']]) {
      const dir=join(root,name);HARNESSES[harness].writeMcpConfig(dir,{name,harness,display:1},templates);
      const server=JSON.parse(readFileSync(join(dir,path))).mcpServers.metor;
      assert.equal(server.command,'node');assert.equal(server.args[1],name);
      assert.equal(server.args[0],'/usr/local/lib/metor/metor-collaboration-mcp.mjs');
      const requests=[{id:1,method:'tools/list'},{id:2,method:'tools/call',params:{name:'send_to_bot',arguments:{to:'delta',text:`Hello from ${harness}`,request_id:'hello'}}},{id:3,method:'tools/call',params:{name:'send_to_bot',arguments:{to:'delta',text:'Spoof',request_id:'spoof',sender:'delta'}}}];
      const r=spawnSync(process.execPath,[join(lib,'metor-collaboration-mcp.mjs'),server.args[1]],{input:requests.map(r=>JSON.stringify({jsonrpc:'2.0',...r})).join('\n')+'\n',encoding:'utf8',env:{...process.env,METOR_BOTS_DIR:root}});
      assert.equal(r.status,0,r.stderr);const replies=r.stdout.trim().split('\n').map(JSON.parse);
      schemas.push(replies[0].result.tools); assert.equal(replies[1].result.isError,undefined);assert.equal(replies[2].result.isError,true);
    }
    assert.deepEqual(schemas[0],schemas[1]);assert.deepEqual(schemas[1],schemas[2]);
    assert.deepEqual(readHistory(root,'delta').map(e=>e.collaboration.sender),['alpha','beta','gamma']);
  } finally {rmSync(root,{recursive:true,force:true})}
});
