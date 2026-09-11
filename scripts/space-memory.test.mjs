import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
test('ordinary wrapper starts retain saved RAM, explicit environment wins and corrupt settings fail closed', () => {
 const dir=mkdtempSync(join(tmpdir(),'metor-memory-wrapper-'));
 try {
  const bin=join(dir,'bin');mkdirSync(bin);
  const log=join(dir,'calls');
  writeFileSync(join(bin,'container'),`#!/bin/bash\nprintf '%s\\n' "$*" >> "$TEST_CALLS"\ncase "$1" in inspect) echo '[{"status":{"state":"stopped"}}]' ;; esac\n`,{mode:0o755});
  const state=join(dir,'metor/resources/container');mkdirSync(state,{recursive:true});const file=join(state,'test-space.memory-mib');writeFileSync(file,'6144\n');
  const env={...process.env,PATH:`${bin}:${process.env.PATH}`,XDG_CONFIG_HOME:dir,METOR_BOX_CONTAINER:'test-space',METOR_BOX_IMAGE:'test-image',METOR_RUNTIME:'container',METOR_MEMORY:'',TEST_CALLS:log};
  const wrapper=resolve('backend/harness/bin/metor');
  execFileSync(wrapper,['box','up'],{env});assert.match(readFileSync(log,'utf8'),/--memory 6144m/);
  writeFileSync(log,'');execFileSync(wrapper,['box','up'],{env:{...env,METOR_MEMORY:'8g'}});assert.match(readFileSync(log,'utf8'),/--memory 8g/);
  writeFileSync(log,'');writeFileSync(file,'invalid');assert.throws(()=>execFileSync(wrapper,['box','up'],{env,stdio:'pipe'}));assert.doesNotMatch(readFileSync(log,'utf8'),/run -d/);
 } finally {rmSync(dir,{recursive:true,force:true})}
});
