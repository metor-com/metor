// Opt-in Linux test: requires a DISPOSABLE, empty Docker daemon, never a live Space.
// Run inside an isolated VM; the real installer uses its normal container/volume names.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
assert.equal(process.env.METOR_DISPOSABLE_DOCKER, 'yes', 'Set METOR_DISPOSABLE_DOCKER=yes only in a disposable VM');
assert.equal(process.platform, 'linux');
const docker = execFileSync('sh', ['-c', 'command -v docker'], { encoding: 'utf8' }).trim();
const rt = (...args) => execFileSync(docker, args, { encoding: 'utf8', maxBuffer: 8 * 1024 ** 2, timeout: 120000 });
assert.equal(rt('ps', '-aq').trim(), '', 'Refusing a daemon with existing containers');
assert.equal(rt('volume', 'ls', '-q').trim(), '', 'Refusing a daemon with existing volumes');
assert.ok(!existsSync('/opt/metor'), 'Refusing an existing install');
const image = process.env.METOR_RECOVERY_IMAGE || 'ghcr.io/metor-com/metor-box:0.4.0';
const root = mkdtempSync(join(tmpdir(), 'metor-real-recovery-')), bin = join(root, 'bin'), dir = '/opt/metor';
mkdirSync(bin); mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, '.desktop-install'), 'localhost');
writeFileSync(join(dir, '.env'), 'METOR_MEMORY=2048M\nMETOR_ROUTINE_GUARD=7\n');
// A fault-injection wrapper delegates every operation to Docker. It only stops the
// installer at deterministic boundaries, including a partially written compose file.
writeFileSync(join(bin, 'docker'), `#!/bin/bash
set -eu
pause() { touch "$TEST_ROOT/paused"; sleep 300; }
case "$*" in
  'pull -q '*) [ "$FAIL_PHASE" != image ] || pause ;;
  'run --rm --entrypoint cat '*)
    if [ "$FAIL_PHASE" = files ]; then
      "$REAL_DOCKER" "$@" > "$TEST_ROOT/compose"
      head -c 20 "$TEST_ROOT/compose"
      pause
    fi ;;
  'compose --profile caddy up -d')
    if [ "$FAIL_PHASE" = start ]; then "$REAL_DOCKER" "$@"; pause; fi ;;
  'compose exec -T box curl '*) [ "$FAIL_PHASE" != gateway ] || pause ;;
esac
exec "$REAL_DOCKER" "$@"
`, { mode: 0o755 });
const delay = ms => new Promise(r => setTimeout(r, ms));
let active;
function start(failure = '') {
  const child = spawn('bash', [resolve('deploy/install.sh')], { detached: true, env: { ...process.env,
    PATH: `${bin}:${process.env.PATH}`, REAL_DOCKER: docker, TEST_ROOT: root, FAIL_PHASE: failure,
    METOR_APP_INSTALL: 'yes', METOR_DOMAIN: 'localhost', METOR_MEMORY: '2048M', METOR_IMAGE: image, METOR_INSTALL_DOCKER: 'no',
  }, stdio: ['ignore', 'pipe', 'pipe'] });
  active = child; let output = '';
  child.stdout.on('data', b => output = (output + b).slice(-100000));
  child.stderr.on('data', b => output = (output + b).slice(-100000));
  const done = new Promise((resolve, reject) => { child.on('error', reject); child.on('close', (code, signal) => resolve({ code, signal, output })); });
  return { child, done };
}
async function complete() {
  const { done, child } = start();
  const timer = setTimeout(() => process.kill(-child.pid, 'SIGKILL'), 15 * 60 * 1000);
  const result = await done; clearTimeout(timer); active = null;
  // Redact pairing tokens before exposing failure output.
  assert.equal(result.code, 0, `Installer failed; phase ${readFileSync(join(dir, '.desktop-phase'), 'utf8').trim()}: ${result.output.replace(/token=[\w-]+/g, "token=[redacted]")}`);
  assert.equal(readFileSync(join(dir, '.desktop-phase'), 'utf8').trim(), 'ready');
}
const origin = 'http://127.0.0.1:6010/bots';
try {
  await complete();
  rt('exec', 'metor-box', 'metor', 'bot', 'create', 'recovery-probe', '--role', 'Recovery test', '--no-start');
  const marker = 'recovery-retained';
  rt('exec', 'metor-box', 'node', '-e', `const fs=require('fs');fs.mkdirSync('/workspace/bots/recovery-probe/.metor',{recursive:true});fs.writeFileSync('/workspace/bots/recovery-probe/retained.txt','${marker}');fs.writeFileSync('/workspace/bots/recovery-probe/.metor/chat.jsonl',JSON.stringify({v:2,id:'recovery-message',role:'user',kind:'text',text:'${marker}'})+'\\n');for(const k of ['claude','codex','gemini','copilot'])fs.writeFileSync('/home/box/.'+k+'/recovery-marker','${marker}')`);
  const chat = rt('exec', 'metor-box', 'cat', '/workspace/bots/recovery-probe/.metor/chat.jsonl');
  const token = rt('exec', 'metor-box', 'metor', 'auth', 'link', '--plain').match(/token=([\w-]+)/)[1];
  const auth = await fetch(origin + '/api/auth/redeem', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token }) });
  assert.equal(auth.status, 200);
  const { secret } = await auth.json(), headers = { authorization: `Bearer ${secret}` };
  for (const phase of ['image', 'files', 'start', 'gateway']) {
    rmSync(join(root, 'paused'), { force: true });
    const first = start(phase); let ended = false; first.done.then(() => ended = true);
    const deadline = Date.now() + 120000;
    while (!existsSync(join(root, 'paused')) && !ended && Date.now() < deadline) await delay(100);
    assert.ok(existsSync(join(root, 'paused')), `Reached ${phase} boundary`);
    process.kill(-first.child.pid, 'SIGKILL'); assert.equal((await first.done).signal, 'SIGKILL'); active = null;
    assert.equal(readFileSync(join(dir, '.desktop-phase'), 'utf8').trim(), phase);
    await complete();
    const bots = await (await fetch(origin + '/api/agents', { headers })).json();
    assert.ok(bots.some(b => b.name === 'recovery-probe'), 'Bot and paired device survive');
    assert.equal(rt('exec', 'metor-box', 'cat', '/workspace/bots/recovery-probe/retained.txt'), marker);
    assert.equal(rt('exec', 'metor-box', 'cat', '/workspace/bots/recovery-probe/.metor/chat.jsonl'), chat);
    for (const k of ['claude', 'codex', 'gemini', 'copilot']) assert.equal(rt('exec', 'metor-box', 'cat', `/home/box/.${k}/recovery-marker`), marker);
    const env = readFileSync(join(dir, '.env'), 'utf8');
    assert.match(env, /^METOR_ROUTINE_GUARD=7$/m); assert.match(env, /^METOR_MEMORY=2048M$/m);
    assert.equal(JSON.parse(rt('inspect', 'metor-box'))[0].HostConfig.Memory, 2048 * 1024 ** 2);
    console.log(`PASS: real Docker SIGKILL/retry at ${phase}; bots, chat, files, device, runtime volumes and RAM retained`);
  }
  // Trust only this test's Caddy CA: exercise actual TLS without bypassing verification.
  const caddy = rt('ps', '--filter', 'label=com.docker.compose.service=caddy', '--format', '{{.ID}}').trim();
  rt('cp', `${caddy}:/data/caddy/pki/authorities/local/root.crt`, join(root, 'ca.crt'));
  const response = execFileSync('curl', ['-fsS', '--max-time', '10', '--cacert', join(root, 'ca.crt'), 'https://localhost/bots/api/version'], { encoding: 'utf8' });
  assert.equal(JSON.parse(response).name, 'metor');
  console.log('PASS: real Caddy TLS and gateway routing with an explicitly trusted test CA');
} finally {
  if (active) { try { process.kill(-active.pid, 'SIGKILL'); } catch {} }
  // Only the compose project created after the empty-daemon check is removed.
  if (existsSync(join(dir, 'compose.yml'))) {
    try { rt('compose', '--project-directory', dir, '--profile', 'caddy', 'down', '--volumes', '--remove-orphans'); } catch {}
  }
  rmSync(dir, { recursive: true, force: true }); rmSync(root, { recursive: true, force: true });
}
