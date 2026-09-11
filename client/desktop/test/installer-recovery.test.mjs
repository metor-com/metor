// Runs the actual installer in a temporary filesystem. Docker is a deterministic test double;
// no real Space is stopped. SIGKILL models power loss, including partial file writes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
const installer = new URL('../../../deploy/install.sh', import.meta.url).pathname;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
for (const failure of ['image', 'files', 'start', 'gateway']) test(`SIGKILL during ${failure}: retry preserves data and settings`, async t => {
  const root = mkdtempSync(join(tmpdir(), 'metor-install-recovery-'));
  const bin = join(root, 'bin'), dir = join(root, 'space');
  mkdirSync(bin); mkdirSync(dir);
  writeFileSync(join(dir, '.desktop-install'), 'bots.example.com');
  writeFileSync(join(dir, '.env'), 'METOR_MEMORY=2048M\nMETOR_ROUTINE_GUARD=7\n');
  writeFileSync(join(dir, 'user-data'), 'keep my bots and sessions');
  const executable = (name, source) => writeFileSync(join(bin, name), '#!/bin/bash\n' + source, { mode: 0o755 });
  executable('id', 'echo 0'); executable('curl', 'echo 203.0.113.10'); executable('ss', 'exit 0'); executable('sleep', 'exit 0');
  executable('docker', `
case "$*" in
  'compose version'|'manifest inspect '* ) exit 0 ;;
  'pull -q '*) stage=image ;;
  'run --rm --entrypoint cat '*) stage=files ;;
  'compose --profile caddy up -d') stage=start ;;
  'compose exec -T box curl '*) stage=gateway ;;
  'compose exec -T box metor auth link') echo 'https://bots.example.com/bots/auth/claim?token=fixture-secret'; exit 0 ;;
  *) exit 0 ;;
esac
if [ "$stage" = "$FAIL_PHASE" ]; then
  [ "$stage" != files ] || printf 'partial compose'
  touch "$TEST_ROOT/paused"
  /bin/sleep 30
fi
case "$stage" in files) printf 'services:\\n  box:\\n    image: fixture\\n' ;; gateway) echo 401 ;; esac
`);
  const start = fail => {
    const child = spawn('bash', [installer], { detached: true, env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, METOR_DIR: dir, METOR_DOMAIN: 'bots.example.com', METOR_MEMORY: '2048M', METOR_IMAGE: 'fixture:1', METOR_APP_INSTALL: 'yes', FAIL_PHASE: fail, TEST_ROOT: root }, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = ''; child.stdout.on('data', b => output += b); child.stderr.on('data', b => output += b);
    const done = new Promise(resolve => child.on('close', (code, signal) => resolve({ code, signal, output })));
    return { child, done };
  };
  let active;
  t.after(() => { if (active) { try { process.kill(-active.pid, 'SIGKILL'); } catch {} } rmSync(root, { recursive: true, force: true }); });
  const first = start(failure); active = first.child;
  const deadline = Date.now() + 5000;
  while (!existsSync(join(root, 'paused')) && Date.now() < deadline) await pause(20);
  assert.ok(existsSync(join(root, 'paused')), 'installer reached failure point');
  process.kill(-first.child.pid, 'SIGKILL');
  assert.equal((await first.done).signal, 'SIGKILL'); active = null;
  assert.equal(readFileSync(join(dir, '.desktop-phase'), 'utf8').trim(), failure);
  const second = start(''); active = second.child;
  const result = await second.done; active = null;
  assert.equal(result.code, 0);
  assert.equal(readFileSync(join(dir, '.desktop-phase'), 'utf8').trim(), 'ready');
  assert.equal(readFileSync(join(dir, 'user-data'), 'utf8'), 'keep my bots and sessions');
  const env = readFileSync(join(dir, '.env'), 'utf8');
  assert.match(env, /^METOR_ROUTINE_GUARD=7$/m); assert.match(env, /^METOR_MEMORY=2048M$/m);
  assert.equal((env.match(/^METOR_MEMORY=/gm) || []).length, 1);
  assert.match(readFileSync(join(dir, 'compose.yml'), 'utf8'), /^services:/);
  assert.ok(!readFileSync(join(dir, 'compose.yml'), 'utf8').includes('partial'));
});
