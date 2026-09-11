import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import ssh2 from 'ssh2';
import { fingerprint, probe, inspect, install, run, quote, signInError, target, domainName, parseServer } from '../src/server-setup.mjs';
const { Server, utils } = ssh2;
const keyDir = mkdtempSync(join(tmpdir(), 'metor-ssh-test-'));
execFileSync('ssh-keygen', ['-t', 'ed25519', '-N', '', '-f', join(keyDir, 'key')]);
const key = readFileSync(join(keyDir, 'key'));
rmSync(keyDir, { recursive: true });
const fp = fingerprint(utils.parseKey(key).getPublicSSH());
async function server(t, command, changePassword = false, userKey = null) {
  let credentials = 0, keyAttempts = 0;
  const peers = new Set();
  const s = new Server({ hostKeys: [key] }, c => {
    peers.add(c); c.on('error', () => {}); c.on('close', () => peers.delete(c));
    c.on('authentication', ctx => { if (ctx.method === 'publickey') { keyAttempts++; const valid = userKey && ctx.key.data.equals(userKey.getPublicSSH()) && (!ctx.signature || userKey.verify(ctx.blob, ctx.signature, ctx.hashAlgo)); return valid ? ctx.accept() : ctx.reject(); } if (ctx.method === 'password') { credentials++; if (changePassword) return ctx.requestChange('Change your password', () => ctx.reject()); } ctx.method === 'password' && ctx.password === 'test-secret' ? ctx.accept() : ctx.reject(); });
    c.on('ready', () => c.on('session', accept => accept().on('exec', (accept) => {
      const stream = accept(); let script = '';
      stream.on('data', b => script += b.toString());
      stream.on('end', () => { const reply = command?.(script, c); if (reply === null) return; stream.write(typeof reply === 'string' ? reply : 'METOR_SERVER:ubuntu 26.04|2|3900|42000|2816\n'); stream.exit(0); stream.end(); });
    })));
  });
  await new Promise(resolve => s.listen(0, '127.0.0.1', resolve));
  t.after(async () => { for (const c of peers) c.end(); await new Promise(resolve => s.close(resolve)); });
  return { host: '127.0.0.1', port: s.address().port, credentials: () => credentials, keyAttempts: () => keyAttempts };
}
test('host discovery and changed keys never transmit a password', async t => {
  const s = await server(t);
  assert.equal((await probe(s)).fingerprint, fp);
  assert.equal(s.credentials(), 0);
  await assert.rejects(inspect({ ...s, domain: 'bots.example.com', fingerprint: `SHA256:${'A'.repeat(43)}`, password: 'test-secret' }), /identity changed/);
  assert.equal(s.credentials(), 0);
});
test('verified SSH inspects resources and clears the supplied password', async t => {
  const s = await server(t, script => assert.match(script, /METOR_DOMAIN='bots.example.com'/));
  const input = { ...s, domain: 'bots.example.com', fingerprint: fp, password: 'test-secret' };
  const session = await inspect(input);
  assert.equal(s.credentials(), 1); assert.equal(input.password, '');
  assert.equal(session.info.memory, 2816); assert.equal(session.conn.config.password, undefined);
  session.conn.end();
});
test('server inputs reject shell and domain injection', () => {
  for (const host of ['x; touch /tmp/no', '-oProxyCommand=x', 'root@server', 'https://example.com']) assert.throws(() => target({ host }));
  for (const domain of ['example.com\nfoo', 'https://example.com', 'example.com/a', '*.example.com', '127.0.0.1']) assert.throws(() => domainName(domain));
  assert.throws(() => target({ host: 'example.com', port: 0 }));
  const literal = "a'$(echo unsafe)`echo unsafe`\nb";
  assert.equal(execFileSync('bash', ['-c', `printf %s ${quote(literal)}`], { encoding: 'utf8' }), literal);
  assert.throws(() => parseServer('METOR_SERVER:ubuntu|2|NaN|40|8'));
});

test('preflight protects foreign installs and retains allocation on an owned retry', async () => {
  const { mkdirSync, writeFileSync } = await import('node:fs');
  const dir = mkdtempSync(join(tmpdir(), 'metor-preflight-'));
  try {
    writeFileSync(join(dir, 'os'), 'ID=ubuntu\nVERSION_ID=26.04\n');
    writeFileSync(join(dir, 'mem'), 'MemTotal: 3993600 kB\n');
    const script = readFileSync(new URL('../src/server-preflight.sh', import.meta.url), 'utf8')
      .replaceAll('/etc/os-release', join(dir, 'os')).replaceAll('/proc/meminfo', join(dir, 'mem')).replaceAll('/opt', dir);
    const commands = `
export METOR_DOMAIN=bots.example.com
id() { echo 0; }
uname() { echo x86_64; }
getconf() { echo 2; }
df() { printf 'Filesystem blocks used available capacity mount\nx 50000 8000 42000 16%% /\n'; }
ss() { :; }
flock() { :; }
docker() { if [ "$1" = ps ] && [ "\${FOREIGN:-}" = yes ]; then echo another-service; fi; }
`;
    const check = extra => execFileSync('bash', ['-s'], { input: commands + (extra || '') + script, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    assert.equal(parseServer(check()).memory, 2816);
    assert.throws(() => check('export FOREIGN=yes\n'), e => /Existing Docker containers/.test(e.stdout));
    mkdirSync(join(dir, 'metor'));
    assert.throws(() => check(), e => /will not be overwritten/.test(e.stdout));
    writeFileSync(join(dir, 'metor/.desktop-install'), 'bots.example.com');
    writeFileSync(join(dir, 'metor/.env'), 'METOR_MEMORY=2048M\n');
    assert.equal(parseServer(check()).memory, 2048);
    assert.throws(() => check('export METOR_DOMAIN=other.example.com\n'), e => /another domain/.test(e.stdout));
    writeFileSync(join(dir, 'mem'), 'MemTotal: 1048576 kB\n');
    assert.throws(() => check(), e => /At least 4 GB/.test(e.stdout));
  } finally { rmSync(dir, { recursive: true }); }
});


test('installation pins the release, allocates RAM, and keeps the setup token out of progress', async t => {
  const s = await server(t, script => {
    if (!script.includes('METOR_APP_INSTALL')) return;
    assert.match(script, /metor-box:0\.4\.0/);
    assert.match(script, /METOR_MEMORY='2816M'/);
    assert.match(script, /flock -n 9/);
    assert.ok(script.indexOf('Existing Docker containers') < script.indexOf('stage=$(mktemp'));
    return 'Pulling ghcr.io/metor-com/metor-box:0.4.0\nStarting metor\nhttps://bots.example.com/bots/auth/claim?token=one-time-secret\n';
  });
  const session = await inspect({ ...s, domain: 'bots.example.com', fingerprint: fp, password: 'test-secret' });
  const progress = [];
  const link = await install(session, '# installer fixture\n', '0.4.0', line => progress.push(line));
  assert.equal(link, 'https://bots.example.com/bots/auth/claim?token=one-time-secret');
  assert.ok(progress.length >= 3);
  assert.ok(!progress.join().includes('one-time-secret'));
  session.conn.end();
});


test('expired passwords prompt for an explicit password change without timing out', async t => {
  const s = await server(t, null, true);
  const input = { ...s, domain: 'bots.example.com', fingerprint: fp, password: 'test-secret' };
  await assert.rejects(inspect(input), /requires a new root password/);
  assert.equal(input.password, '');
});
test('network errors are not described as a rejected password', () => {
  assert.match(signInError({ level: 'client-timeout' }), /timed out/);
  assert.match(signInError({ code: 'ECONNREFUSED' }), /refused the SSH connection/);
  assert.match(signInError({ code: 'ENOTFOUND' }), /could not be resolved/);
  assert.match(signInError({ level: 'client-authentication' }), /rejected root password login/);
  assert.match(signInError({}, true), /identity changed/);
});


test('SSH private-key login verifies signatures and clears temporary key material', async t => {
  const s = await server(t, null, false, utils.parseKey(key));
  const input = { ...s, domain: 'bots.example.com', fingerprint: fp, authMethod: 'key', privateKey: Buffer.from(key) };
  const session = await inspect(input);
  assert.ok(s.keyAttempts() > 0); assert.equal(s.credentials(), 0);
  assert.ok(input.privateKey.every(b => b === 0));
  assert.equal(session.conn.config.privateKey, undefined);
  session.conn.end();
});
test('changed host identity never receives the public-key authentication offer', async t => {
  const s = await server(t, null, false, utils.parseKey(key));
  await assert.rejects(inspect({ ...s, domain: 'bots.example.com', fingerprint: `SHA256:${'A'.repeat(43)}`, authMethod: 'key', privateKey: Buffer.from(key) }), /identity changed/);
  assert.equal(s.keyAttempts(), 0);
});
test('encrypted private keys unlock locally; wrong passphrases never reach SSH', async t => {
  const { writeFileSync } = await import('node:fs');
  const dir = mkdtempSync(join(tmpdir(), 'metor-encrypted-key-'));
  try {
    const path = join(dir, 'key'); writeFileSync(path, key, { mode: 0o600 });
    execFileSync('ssh-keygen', ['-p', '-P', '', '-N', 'fixture-passphrase', '-f', path]);
    const encrypted = readFileSync(path);
    const s = await server(t, null, false, utils.parseKey(key));
    await assert.rejects(inspect({ ...s, domain: 'bots.example.com', fingerprint: fp, authMethod: 'key', privateKey: Buffer.from(encrypted), passphrase: 'wrong' }), /Could not unlock/);
    assert.equal(s.keyAttempts(), 0);
    const input = { ...s, domain: 'bots.example.com', fingerprint: fp, authMethod: 'key', privateKey: encrypted, passphrase: 'fixture-passphrase' };
    const session = await inspect(input); assert.equal(input.passphrase, ''); session.conn.end();
  } finally { rmSync(dir, { recursive: true }); }
});
test('a completed installation reconnects without downloading images or restarting containers', async t => {
  const s = await server(t, script => {
    if (script.includes('docker compose exec -T box metor auth link')) {
      assert.ok(!script.includes('docker pull')); assert.ok(!script.includes('up -d'));
      return 'https://bots.example.com/bots/auth/claim?token=reconnect-secret';
    }
    return 'METOR_SERVER:ubuntu 26.04|2|3900|42000|2816\nMETOR_RESUME:ready\n';
  });
  const session = await inspect({ ...s, domain: 'bots.example.com', fingerprint: fp, password: 'test-secret' });
  assert.equal(session.info.resume, 'ready');
  assert.match(await install(session, 'must not execute', '0.4.0'), /reconnect-secret/);
  session.conn.end();
});


test('an SSH disconnect during a command rejects promptly and allows a fresh connection', async t => {
  let disconnect = true;
  const s = await server(t, (_script, connection) => { if (disconnect) { disconnect = false; connection.end(); return null; } });
  await assert.rejects(inspect({ ...s, domain: 'bots.example.com', fingerprint: fp, password: 'test-secret' }), /interrupted|failed/);
  const session = await inspect({ ...s, domain: 'bots.example.com', fingerprint: fp, password: 'test-secret' });
  assert.equal(session.info.cpus, 2); session.conn.end();
});
test('an unrecognized SSH key reports key rejection, without password fallback', async t => {
  const s = await server(t);
  await assert.rejects(inspect({ ...s, domain: 'bots.example.com', fingerprint: fp, authMethod: 'key', privateKey: Buffer.from(key) }), /rejected this SSH key/);
  assert.equal(s.credentials(), 0);
});
