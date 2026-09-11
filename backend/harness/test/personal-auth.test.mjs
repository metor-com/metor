import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

test('personal devices: pairing, single use, revocation and expiry', async () => {
 const dir=mkdtempSync(join(tmpdir(),'metor-auth-'));
 process.env.METOR_AUTH_DIR=dir;
 try {
  const auth=await import('../bin/metor-auth.mjs?personal');
  const first=auth.claimSession(auth.createClaim('setup'));
  const pairing=auth.createClaim('pair',{createdBy:first.session.id});
  const second=auth.claimSession({code:pairing.code});
  assert.ok(second);
  assert.equal(auth.claimSession({token:pairing.token}),null);
  assert.equal(auth.listSessions().length,2);
  const request={headers:{authorization:`Bearer ${second.secret}`}};
  assert.equal(auth.sessionOf(request).id,second.session.id);
  auth.revokeSession(second.session.id);
  assert.equal(auth.sessionOf(request),null);
  assert.equal(auth.sessionAlive(second.session.id),false);
  const file=join(dir,'auth.json'), db=JSON.parse(readFileSync(file));
  db.sessions[0].expiresAt=Date.now()-1;writeFileSync(file,JSON.stringify(db));
  assert.equal(auth.sessionOf({headers:{authorization:`Bearer ${first.secret}`}}),null);
 } finally {rmSync(dir,{recursive:true,force:true})}
});

test('prototype migration preserves own devices without upgrading invitations; corrupt data fails closed', async () => {
 const dir=mkdtempSync(join(tmpdir(),'metor-auth-'));
 process.env.METOR_AUTH_DIR=dir;
 try {
  const file=join(dir,'auth.json'), stamp=Date.now();
  const hash=value=>createHash('sha256').update(value).digest('hex');
  const session=(id,memberId)=>({id,memberId,hash:hash(id),createdAt:stamp,lastSeenAt:stamp,expiresAt:stamp+60000});
  writeFileSync(file,JSON.stringify({members:[{id:'own',role:'owner'},{id:'guest',role:'admin'}],sessions:[session('device','own'),session('invited','guest')],claims:[{kind:'pair',memberId:'own',hash:hash('pair'),expiresAt:stamp+60000},{kind:'invite',memberId:'own',hash:hash('invite'),expiresAt:stamp+60000},{kind:'pair',memberId:'guest',hash:hash('guest-pair'),expiresAt:stamp+60000}]}));
  const auth=await import('../bin/metor-auth.mjs?migration');
  assert.equal(auth.sessionOf({headers:{authorization:'Bearer device'}}).id,'device');
  assert.equal(auth.sessionOf({headers:{authorization:'Bearer invited'}}),null);
  assert.equal(auth.claimOpen('invite'),false);
  assert.equal(auth.claimOpen('guest-pair'),false);
  assert.ok(auth.claimSession({token:'pair'}));
  const db=JSON.parse(readFileSync(file));
  assert.equal(db.members,undefined);
  assert.ok(db.sessions.every(s=>s.memberId===undefined));
  writeFileSync(file,'broken');
  assert.throws(()=>auth.createClaim('setup'));
  assert.equal(readFileSync(file,'utf8'),'broken');
 } finally {rmSync(dir,{recursive:true,force:true})}
});
