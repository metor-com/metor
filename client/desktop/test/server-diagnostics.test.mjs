import test from 'node:test';
import assert from 'node:assert/strict';
import { checkDomain, explainHttps, waitForHttps } from '../src/server-diagnostics.mjs';
import { installationError } from '../src/server-setup.mjs';
test('DNS detects missing records and stale IPv6 alongside valid IPv4', async () => {
  assert.equal((await checkDomain('bots.example.com', [], async () => { throw Error('NXDOMAIN'); })).ok, false);
  const resolve = async () => [{ address: '203.0.113.1' }, { address: '2001:db8::2' }];
  const result = await checkDomain('bots.example.com', ['203.0.113.1'], resolve);
  assert.equal(result.ok, false); assert.match(result.message, /2001:db8::2/);
  assert.equal((await checkDomain('bots.example.com', ['203.0.113.1', '2001:0db8:0:0:0:0:0:2'], resolve)).ok, true);
});
const dns = async () => ({ ok: true, addresses: ['203.0.113.1'] });
test('HTTPS diagnostics distinguish DNS, network ports, certificates and routing', async () => {
  assert.equal(await explainHttps('bots.example.com', [], {}, { checkDomain: async () => ({ ok: false, message: 'DNS detail' }) }), 'DNS detail');
  assert.match(await explainHttps('bots.example.com', [], {}, { checkDomain: dns, checkPort: async () => false }), /port 443 is not reachable/);
  assert.match(await explainHttps('bots.example.com', [], { kind: 'certificate' }, { checkDomain: dns, checkPort: async (_, port) => port === 443 }), /Port 80 is also unreachable/);
  assert.match(await explainHttps('bots.example.com', [], { kind: 'response', status: 502 }, { checkDomain: dns, checkPort: async () => true }), /HTTP 502/);
});
test('HTTPS readiness retries, stops on success, and returns actionable failure', async () => {
  let calls = 0;
  await waitForHttps('bots.example.com', [], () => {}, { attempts: 3, delay: async () => {}, check: async () => ({ ok: ++calls === 2 }) });
  assert.equal(calls, 2);
  await assert.rejects(waitForHttps('bots.example.com', [], () => {}, { attempts: 1, check: async () => ({ ok: false, kind: 'certificate' }), checkDomain: dns, checkPort: async () => true }), /certificate/);
  await assert.rejects(waitForHttps('bots.example.com', [], () => {}, { cancelled: () => true }), /window was closed/);
});
test('installer phase errors provide concrete remediation without raw output', () => {
  assert.match(installationError('image'), /ghcr.io/);
  assert.match(installationError('docker'), /package-manager/);
  assert.match(installationError('gateway'), /RAM/);
});
