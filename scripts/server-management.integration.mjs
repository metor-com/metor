// Real OpenSSH + Docker management test in an explicitly disposable Colima profile.
// No provider account or personal Space is accessed; do not use a general VM profile.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { probe, inspect, install, run } from '../client/desktop/src/server-setup.mjs';
import { serverStatus, updateServer } from '../client/desktop/src/server-management.mjs';
const profile = process.env.METOR_DISPOSABLE_COLIMA;
assert.match(profile || '', /^metor-(recovery|test-[a-z0-9-]+)$/);
const remote = (...args) => execFileSync('colima', ['-p', profile, 'ssh', '--', ...args], { encoding: 'utf8', timeout: 120000, maxBuffer: 2 * 1024 ** 2 });
assert.equal(remote('sudo', 'docker', 'ps', '-aq').trim(), '');
assert.equal(remote('sudo', 'docker', 'volume', 'ls', '-q').trim(), '');
remote('sudo', 'test', '!', '-e', '/opt/metor');
const config = execFileSync('colima', ['-p', profile, 'ssh-config'], { encoding: 'utf8' });
const keyPath = /^\s+IdentityFile "([^"]+)"/m.exec(config)?.[1];
const port = Number(/^\s+Port (\d+)/m.exec(config)?.[1]);
assert.ok(keyPath && port);
const verifiedFingerprint = remote('sudo', 'ssh-keygen', '-lf', '/etc/ssh/ssh_host_ed25519_key.pub').split(/\s+/)[1];
const address = { host: '127.0.0.1', port }, domain = 'recovery.localhost';
assert.equal((await probe(address)).fingerprint, verifiedFingerprint);
const input = () => ({ ...address, domain, fingerprint: verifiedFingerprint, authMethod: 'key', privateKey: readFileSync(keyPath) });
let session, created = false;
const previousKeys = remote('sudo', 'cat', '/root/.ssh/authorized_keys');
const publicKey = execFileSync('ssh-keygen', ['-y', '-f', keyPath], { encoding: 'utf8' });
const writeKeys = value => execFileSync('colima', ['-p', profile, 'ssh', '--', 'sudo', 'tee', '/root/.ssh/authorized_keys'], { input: value, stdio: ['pipe', 'ignore', 'pipe'] });
try {
  // Colima provisions user SSH access; grant its test key root access only in this VM.
  writeKeys(previousKeys + '\n' + publicKey + '\n');
  session = await inspect(input());
  created = true;
  await install(session, readFileSync(new URL('../deploy/install.sh', import.meta.url), 'utf8'), '0.3.0', message => console.log(message));
  session.conn.end();
  session = await inspect(input(), serverStatus);
  assert.equal(session.info.version, '0.3.0'); assert.equal(session.info.running, true);
  const initialMemory = session.info.memory;
  await run(session.conn, "docker exec metor-box metor bot create management-probe --role 'Management test' --no-start\n");
  const seed = `const fs=require('fs');fs.writeFileSync('/workspace/bots/management-probe/retained.txt','management-retained');for(const k of ['claude','codex','gemini'])fs.writeFileSync('/home/box/.'+k+'/management-marker','management-retained')`;
  remote('sudo', 'docker', 'exec', 'metor-box', 'node', '-e', seed);
  const caddyBefore = remote('sudo', 'docker', 'ps', '--filter', 'label=com.docker.compose.service=caddy', '--format', '{{.ID}}').trim();
  const link = await run(session.conn, 'docker exec metor-box metor auth link --plain\n');
  const token = /token=([\w-]+)/.exec(link)[1];
  // Redeem through the real gateway in the VM. The device secret stays in test memory.
  const redeem = `fetch('http://127.0.0.1:6010/bots/api/auth/redeem',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token:${JSON.stringify(token)}})}).then(r=>r.json()).then(r=>console.log(r.secret))`;
  const secret = remote('sudo', 'docker', 'exec', 'metor-box', 'node', '-e', redeem).trim();
  assert.ok(secret && secret !== 'undefined');
  const state = await updateServer(session, '0.4.0');
  assert.equal(state.version, '0.4.0'); assert.equal(state.memory, initialMemory); assert.equal(state.running, true);
  assert.equal(remote('sudo', 'docker', 'ps', '--filter', 'label=com.docker.compose.service=caddy', '--format', '{{.ID}}').trim(), caddyBefore);
  assert.equal(remote('sudo', 'docker', 'exec', 'metor-box', 'cat', '/workspace/bots/management-probe/retained.txt'), 'management-retained');
  for (const k of ['claude', 'codex', 'gemini']) assert.equal(remote('sudo', 'docker', 'exec', 'metor-box', 'cat', `/home/box/.${k}/management-marker`), 'management-retained');
  const checkDevice = `fetch('http://127.0.0.1:6010/bots/api/agents',{headers:{authorization:'Bearer '+${JSON.stringify(secret)}}}).then(async r=>{if(r.status!==200)process.exit(1);console.log((await r.json()).some(b=>b.name==='management-probe'))})`;
  assert.equal(remote('sudo', 'docker', 'exec', 'metor-box', 'node', '-e', checkDevice).trim(), 'true');
  const mounts = JSON.parse(remote('sudo', 'docker', 'inspect', 'metor-box'))[0].Mounts;
  assert.ok(mounts.some(m => m.Destination === '/home/box/.copilot' && m.Type === 'volume'), 'New release adds its Copilot volume');
  remote('sudo', 'test', '!', '-e', '/opt/metor/.env.before-update');
  remote('sudo', 'test', '!', '-e', '/opt/metor/compose.yml.before-update');
  await assert.rejects(updateServer(session, '0.4.0'), /Only an upgrade/);
  const boxBeforeReconnect = remote('sudo', 'docker', 'inspect', '-f', '{{.Id}}', 'metor-box').trim();
  session.conn.end(); session = await inspect(input());
  assert.equal(session.info.resume, 'ready');
  const claim = await install(session, readFileSync(new URL('../deploy/install.sh', import.meta.url), 'utf8'), '0.4.0');
  assert.ok(claim.startsWith(`https://${domain}/bots/auth/claim?token=`));
  assert.equal(remote('sudo', 'docker', 'inspect', '-f', '{{.Id}}', 'metor-box').trim(), boxBeforeReconnect);
  console.log('PASS: completed setup reconnects through real SSH without restarting the upgraded Space');
  console.log('PASS: real OpenSSH private-key setup, diagnostics and 0.3.0 → 0.4.0 update; data, runtime volumes, device and RAM retained; Caddy not restarted; repeat upgrade rejected');
} finally {
  session?.conn.end();
  writeKeys(previousKeys);
  if (created) {
    try { remote('sudo', 'docker', 'compose', '--project-directory', '/opt/metor', '--profile', 'caddy', 'down', '--volumes', '--remove-orphans'); } catch {}
    remote('sudo', 'rm', '-rf', '/opt/metor');
  }
}
