// Incremental local builds and Space reuse. State is private to this checkout;
// image identity is checked against the runtime, never inferred from a tag alone.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
const runtime = process.env.METOR_RUNTIME ?? 'container';
const image = process.env.METOR_BOX_IMAGE ?? 'metor-box:resize-test';
const name = process.env.METOR_BOX_CONTAINER ?? 'metor-box';
const wrapper = join(root, 'backend/harness/bin/metor');
const cache = join(root, '.metor-dev');
const stateFile = join(cache, 'build.json');
const ignored = new Set(['node_modules', 'dist', '.DS_Store', '.git']);
export function fingerprint(paths) {
  const hash = createHash('sha256');
  function visit(path) {
    hash.update(path + '\0');
    if (!existsSync(path)) { hash.update('missing\0'); return; }
    hash.update(String(statSync(path).mode & 0o777) + '\0');
    if (statSync(path).isDirectory()) {
      for (const child of readdirSync(path).sort()) if (!ignored.has(child)) visit(join(path, child));
    } else hash.update(readFileSync(path));
  }
  for (const path of paths) visit(path);
  return hash.digest('hex');
}
function readState() { try { return JSON.parse(readFileSync(stateFile)); } catch { return {}; } }
function save(state) { writeFileSync(stateFile + '.tmp', JSON.stringify(state, null, 2) + '\n'); renameSync(stateFile + '.tmp', stateFile); }
const capture = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 16 * 1024 * 1024 });
const run = (cmd, args, options = {}) => execFileSync(cmd, args, { stdio: 'inherit', ...options });
function inspect(args) { try { return JSON.parse(capture(runtime, args))[0]; } catch { return null; } }
export function imageId(info, rt) { return rt === 'docker' ? info?.Id : info?.configuration?.descriptor?.digest; }
export function runningImage(info, rt) { return rt === 'docker' ? info?.Image : info?.configuration?.image?.descriptor?.digest; }
export function isRunning(info, rt) { return rt === 'docker' ? info?.State?.Running === true : info?.status?.state === 'running'; }
const uiOutput = () => fingerprint(['client/desktop/ui', 'client/desktop/resources/metor']);

function build(force) {
  const state = readState();
  state.dependencies ??= {};
  for (const project of ['frontend', 'client/desktop']) {
    const hash = fingerprint([`${project}/package.json`, `${project}/package-lock.json`]);
    if (state.dependencies[project] !== hash || !existsSync(`${project}/node_modules`)) {
      console.log(`Installing dependencies for ${project}…`);
      run('npm', ['ci', '--prefix', project]);
      state.dependencies[project] = hash;
      save(state);
    }
  }
  // Some npm installations suppress dependency postinstall scripts. Ensure the
  // pinned Electron package has its platform binary before caching a usable build.
  let electron = '';
  try { electron = capture(process.execPath, ['-e', "console.log(require('./client/desktop/node_modules/electron'))"]).trim(); } catch {}
  if (!electron || !existsSync(electron)) {
    console.log('Installing the Electron desktop binary…');
    run(process.execPath, ['client/desktop/node_modules/electron/install.js']);
  }
  const ui = fingerprint(['frontend', 'client/desktop/scripts/copy-ui.mjs', 'client/desktop/package.json', 'backend/harness/bin/metor']);
  if (force || state.ui?.source !== ui || !existsSync('client/desktop/ui/index.html') || state.ui.output !== uiOutput()) {
    console.log('Building the desktop interface…');
    run('npm', ['--prefix', 'client/desktop', 'run', 'ui']);
    state.ui = { source: ui, output: uiOutput() }; save(state);
  } else console.log('Interface unchanged — using the existing build.');
  const backend = fingerprint(['backend/box', 'backend/harness/bin', 'backend/harness/templates', 'backend/harness/hooks', 'VERSION', 'deploy/compose.yml', '.dockerignore']);
  const id = imageId(inspect(['image', 'inspect', image]), runtime);
  const key = `${runtime}/${image}`;
  state.images ??= {};
  if (force || !id || state.images[key]?.source !== backend || state.images[key]?.id !== id) {
    console.log(`Building ${image} (reusing the desktop interface)…`);
    run(wrapper, ['box', 'build'], { env: { ...process.env, METOR_PREBUILT_UI: '1' } });
    const built = imageId(inspect(['image', 'inspect', image]), runtime);
    if (!built) throw new Error('Built image could not be verified.');
    state.images[key] = { source: backend, id: built }; save(state);
  } else console.log('Backend unchanged — skipping the image build and export.');
  console.log('Build complete. Open run.command to start metor.');
}
function start(restart) {
  if (!existsSync('client/desktop/ui/index.html') || !existsSync('client/desktop/node_modules/.bin/electron')) throw new Error('Run build.command first.');
  if (runtime === 'container') run(runtime, ['system', 'start', '--enable-kernel-install']);
  const id = imageId(inspect(['image', 'inspect', image]), runtime);
  if (!id) throw new Error('Image missing or runtime unavailable. Run build.command first.');
  const current = inspect(['inspect', name]);
  if (isRunning(current, runtime) && !restart && runningImage(current, runtime) === id) {
    console.log('The local Space already uses this image — keeping it running.');
  } else {
    if (isRunning(current, runtime)) {
      console.log(restart ? 'Restarting the local Space as requested…' : 'Applying the new image (saved data is retained)…');
      run(wrapper, ['box', 'down']);
    }
    run(wrapper, ['box', 'up']);
  }
  // Copy only built public UI files. Keep older hashed assets for pages that are
  // still open; replace index.html last, atomically. No gateway/host restart.
  const hash = fingerprint(['client/desktop/ui']);
  const target = '/usr/local/lib/metor/frontend';
  let installed = ''; try { installed = capture(runtime, ['exec', name, 'cat', `${target}/.local-ui-digest`]).trim(); } catch {}
  if (installed !== hash) {
    console.log('Updating the Space interface without restarting bots…');
    const archive = execFileSync('tar', [...(process.platform === 'darwin' ? ['--no-xattrs'] : []), '-C', 'client/desktop/ui', '-cf', '-', '.'], { maxBuffer: 32 * 1024 * 1024, env: { ...process.env, COPYFILE_DISABLE: '1' } });
    const stage = `/tmp/metor-ui-${hash}`;
    const script = `set -eu; mkdir -p ${stage} ${target}; trap 'rm -rf ${stage}' EXIT; tar -xf - -C ${stage}; mv ${stage}/index.html ${stage}/.next-index; cp -R ${stage}/. ${target}/; mv ${target}/.next-index ${target}/index.html; printf '%s' ${hash} > ${target}/.local-ui-digest`;
    execFileSync(runtime, ['exec', '-i', '--user', '0', name, 'sh', '-c', script], { input: archive, stdio: ['pipe', 'inherit', 'inherit'] });
  } else console.log('Space interface is current.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, flag, ...extra] = process.argv.slice(2);
  if (!['build', 'start'].includes(command) || extra.length || (flag && flag !== (command === 'build' ? '--force' : '--restart'))) throw new Error('Expected build [--force] or start [--restart]');
  if (!['container', 'docker'].includes(runtime)) throw new Error('METOR_RUNTIME must be container or docker');
  mkdirSync(cache, { recursive: true });
  // Keep a second double-click from racing npm ci, image export or UI installation.
  const lock = join(cache, 'lock');
  try { mkdirSync(lock); } catch { throw new Error('Another local build/start is in progress. If it was interrupted, remove .metor-dev/lock and retry.'); }
  try { command === 'build' ? build(flag === '--force') : start(flag === '--restart'); }
  finally { rmSync(lock, { recursive: true, force: true }); }
}
