import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseStatus, canUpdate, updateScript } from '../src/server-management.mjs';
test('diagnostics expose structured state without health logs or credentials', () => {
  const result = parseStatus('METOR_CONTAINER:{"Running":true,"OOMKilled":true,"Health":{"Status":"unhealthy","Log":[{"Output":"private"}]}}\nMETOR_IMAGE:ghcr.io/metor-com/metor-box:0.3.0\nMETOR_VERSION:{"name":"metor","version":"0.3.0"}\nMETOR_LIMIT:2147483648\nMETOR_RESTARTS:2\nMETOR_DISK:40000\n');
  assert.equal(result.running, true); assert.equal(result.oomKilled, true); assert.equal(result.health, 'unhealthy');
  assert.equal(result.version, '0.3.0'); assert.equal(result.memory, 2147483648); assert.equal(result.restarts, 2);
  assert.ok(!JSON.stringify(result).includes('private'));
  assert.equal(parseStatus('METOR_CONTAINER:{"Running":false}').version, null);
});
test('updates reject same version, downgrade, unnumbered and foreign images', () => {
  assert.equal(canUpdate('ghcr.io/metor-com/metor-box:0.3.0', '0.4.0'), true);
  for (const image of ['ghcr.io/metor-com/metor-box:0.4.0', 'ghcr.io/metor-com/metor-box:1.0.0', 'ghcr.io/metor-com/metor-box:latest', 'other:0.3.0']) assert.equal(canUpdate(image, '0.4.0'), false);
  assert.throws(() => updateScript('x;echo bad', 'ghcr.io/metor-com/metor-box:0.3.0', '0.4.0'));
  assert.throws(() => updateScript('bots.example.com', 'ghcr.io/metor-com/metor-box:0.3.0', '0.4.0;bad'));
});
for (const failure of ['none', 'pull', 'start', 'gateway', 'stale', 'pending', 'custom']) test(`update transaction: ${failure}`, () => {
  const root = mkdtempSync(join(tmpdir(), 'metor-update-')), dir = join(root, 'space'), bin = join(root, 'bin');
  mkdirSync(dir); mkdirSync(bin);
  const old = 'METOR_IMAGE=ghcr.io/metor-com/metor-box:0.3.0\nMETOR_MEMORY=2048M\nMETOR_ROUTINE_GUARD=7\n';
  writeFileSync(join(dir, '.env'), old); writeFileSync(join(dir, 'compose.yml'), failure === 'custom' ? 'custom' : 'fixture-old'); writeFileSync(join(dir, '.desktop-install'), 'bots.example.com');
  if (failure === 'pending') writeFileSync(join(dir, '.env.before-update'), 'keep previous backup');
  const exe = (name, source) => writeFileSync(join(bin, name), '#!/bin/bash\n' + source, { mode: 0o755 });
  exe('id', 'echo 0'); exe('flock', 'exit 0'); exe('sleep', 'exit 0');
  exe('docker', `
case "$*" in
  'info') exit 0 ;;
  *'com.docker.compose.project.working_dir'*) echo "$TEST_DIR" ;;
  *'.Config.Image'*) echo 'ghcr.io/metor-com/metor-box:${failure === 'stale' ? '0.2.0' : '0.3.0'}' ;;
  'run --rm --entrypoint cat '*':0.3.0 '*) printf fixture-old ;;
  'run --rm --entrypoint cat '*':0.4.0 '*) printf fixture-new ;;
  'compose -f compose.yml.new config -q') exit 0 ;;
  'pull -q '*) echo pull >> "$TEST_DIR/operations"; ${failure === 'pull' ? 'exit 1' : 'exit 0'} ;;
  'compose up -d --no-deps box')
    echo start >> "$TEST_DIR/operations"
    if [ "$FAILURE" = start ] && grep -q ':0.4.0' "$TEST_DIR/.env"; then exit 1; fi ;;
  'compose exec -T box node '*) [ "$FAILURE" != gateway ] ;;
  *) exit 1 ;;
esac
`);
  const script = updateScript('bots.example.com', 'ghcr.io/metor-com/metor-box:0.3.0', '0.4.0')
    .replaceAll('/opt/metor', dir).replaceAll('/run/metor-desktop-install.lock', join(root, 'lock'));
  try {
    let result = '';
    try { result = execFileSync('bash', ['-c', script], { encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, TEST_DIR: dir, FAILURE: failure }, stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch (e) { result = e.stdout.toString(); assert.notEqual(failure, 'none', result); }
    if (failure === 'none') { assert.match(result, /METOR_PHASE:ready/); assert.equal(readFileSync(join(dir, '.env'), 'utf8'), 'METOR_MEMORY=2048M\nMETOR_ROUTINE_GUARD=7\nMETOR_IMAGE=ghcr.io/metor-com/metor-box:0.4.0\n'); }
    else assert.equal(readFileSync(join(dir, '.env'), 'utf8'), old);
    assert.equal(readFileSync(join(dir, 'compose.yml'), 'utf8'), failure === 'none' ? 'fixture-new' : failure === 'custom' ? 'custom' : 'fixture-old');
    assert.equal(existsSync(join(dir, 'compose.yml.before-update')), false);
    if (failure === 'start' || failure === 'gateway') assert.match(result, /previous image was restarted/);
    if (failure === 'pending') assert.equal(readFileSync(join(dir, '.env.before-update'), 'utf8'), 'keep previous backup');
    else assert.equal(existsSync(join(dir, '.env.before-update')), false);
    if (failure === 'stale' || failure === 'pending' || failure === 'custom') assert.equal(existsSync(join(dir, 'operations')), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
