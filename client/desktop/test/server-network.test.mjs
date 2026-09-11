// Real sockets, DNS resolution and TLS verification; no external server or credentials.
import test from 'node:test';
import assert from 'node:assert/strict';
import https from 'node:https';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { checkDomain, checkPort, checkHttps } from '../src/server-diagnostics.mjs';
test('actual DNS and TCP failures give an unsuccessful result', async () => {
  assert.equal((await checkDomain('metor-nonexistent.invalid')).ok, false);
  const server = https.createServer();
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  assert.equal(await checkPort('127.0.0.1', port), true);
  await new Promise(r => server.close(r));
  assert.equal(await checkPort('127.0.0.1', port), false);
});
test('actual TLS rejects an untrusted certificate and accepts an explicitly trusted test CA', async t => {
  const root = mkdtempSync(join(tmpdir(), 'metor-tls-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const key = join(root, 'key.pem'), cert = join(root, 'cert.pem');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-keyout', key, '-out', cert, '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1'], { stdio: 'ignore' });
  let status = 200, body = JSON.stringify({ name: 'metor', version: '0.4.0' });
  const server = https.createServer({ key: readFileSync(key), cert: readFileSync(cert) }, (_req, res) => { res.writeHead(status); res.end(body); });
  await new Promise(r => server.listen(0, '127.0.0.1', r)); t.after(() => new Promise(r => server.close(r)));
  const domain = `127.0.0.1:${server.address().port}`;
  assert.equal((await checkHttps(domain)).kind, 'certificate');
  const trustedCheck = async () => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', `import { checkHttps } from ${JSON.stringify(new URL('../src/server-diagnostics.mjs', import.meta.url).href)}; console.log(JSON.stringify(await checkHttps(${JSON.stringify(domain)})));`], { env: { ...process.env, NODE_EXTRA_CA_CERTS: cert }, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = ''; child.stdout.on('data', b => output += b);
    const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
    assert.equal(code, 0); return JSON.parse(output);
  };
  assert.equal((await trustedCheck()).ok, true);
  status = 502; body = 'Bad gateway';
  assert.deepEqual(await trustedCheck(), { ok: false, kind: 'response', status: 502 });
  status = 200; body = JSON.stringify({ name: 'another app' });
  assert.equal((await trustedCheck()).ok, false);
});
