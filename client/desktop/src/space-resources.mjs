// Host-side resource management. Runtime CLIs receive argument arrays, never shell text.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { totalmem, freemem, homedir } from 'node:os';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join, dirname } from 'node:path';
const execute = promisify(execFile);
export const MiB = 1024 ** 2;
const GiB = 1024 * MiB;
export function validateAllocation(mib, currentBytes, maxBytes, allowReduction = false) {
  if (!Number.isSafeInteger(mib) || mib < 1024 || mib % 256 !== 0) throw new Error('Choose RAM in steps of 256 MiB, at least 1 GiB.');
  if (mib * MiB === currentBytes) throw new Error('Choose a different RAM allocation.');
  if (mib * MiB < currentBytes && !allowReduction) throw new Error('RAM reductions require a supported restart workflow.');
  if (mib * MiB > maxBytes) throw new Error('This allocation would leave too little RAM for the host or other containers.');
}
export function settingsPath(env, runtime, name) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(name)) throw new Error('Invalid container name.');
  return join(env.XDG_CONFIG_HOME || join(env.HOME || homedir(), '.config'), 'metor', 'resources', runtime, `${name}.memory-mib`);
}
// Preserve the installed image, process, mounts, environment and networking when recreating an Apple VM.
export function appleCreateArgs(info, bytes, imageRef = info.configuration?.image?.reference) {
  const c = info.configuration, p = c?.initProcess;
  if (!p || !c.image?.reference || !c.image?.descriptor?.digest) throw new Error('Cannot read the existing Space configuration.');
  if (c.ssh || c.virtualization || c.readOnly || c.useInit || c.publishedSockets?.length || Object.keys(c.sysctls ?? {}).length || c.runtimeHandler !== 'container-runtime-linux' || (c.networks ?? []).some(n => n.network !== 'default')) throw new Error('This custom container configuration cannot be resized from metor yet.');
  const required = ['/workspace', '/home/box/.claude', '/home/box/.codex', '/home/box/.gemini', '/home/box/.copilot'];
  if (!required.every(path => c.mounts?.some(m => m.destination === path && m.type?.volume?.name))) throw new Error('The Space needs persistent data and sign-in volumes before it can be resized.');
  const args = ['create', '--name', info.id, '--memory', `${bytes / MiB}m`, '--cpus', String(c.resources.cpus), '--shm-size', `${c.shmSize / MiB}m`, '--platform', `${c.platform.os}/${c.platform.architecture}`, '--entrypoint', p.executable];
  if (p.user?.raw?.userString) args.push('--user', p.user.raw.userString);
  else throw new Error('Unsupported container process user.');
  if (p.terminal || p.supplementalGroups?.length) throw new Error('Unsupported container process configuration.');
  if (p.workingDirectory) args.push('--workdir', p.workingDirectory);
  for (const v of p.environment ?? []) args.push('--env', v);
  for (const r of p.rlimits ?? []) { if (!r.type || r.soft === undefined || r.hard === undefined) throw new Error('Unsupported resource limit.'); args.push('--ulimit', `${r.type}=${r.soft}:${r.hard}`); }
  for (const m of c.mounts ?? []) {
    if (!m.type?.volume?.name || (m.options ?? []).some(x => x !== 'ro')) throw new Error('Custom mounts cannot be resized from metor yet.');
    args.push('--volume', `${m.type.volume.name}:${m.destination}${m.options?.includes('ro') ? ':ro' : ''}`);
  }
  for (const port of c.publishedPorts ?? []) {
    if (port.count !== 1) throw new Error('Port ranges cannot be resized from metor yet.');
    args.push('--publish', `${port.hostAddress}:${port.hostPort}:${port.containerPort}/${port.proto}`);
  }
  for (const n of c.networks ?? []) args.push('--network', `${n.network}${n.options?.mtu ? `,mtu=${n.options.mtu}` : ''}`);
  for (const value of c.dns?.nameservers ?? []) args.push('--dns', value);
  for (const value of c.dns?.searchDomains ?? []) args.push('--dns-search', value);
  for (const value of c.dns?.options ?? []) args.push('--dns-option', value);
  for (const value of c.capAdd ?? []) args.push('--cap-add', value);
  for (const value of c.capDrop ?? []) args.push('--cap-drop', value);
  for (const [key, value] of Object.entries(c.labels ?? {})) args.push('--label', `${key}=${value}`);
  if (c.rosetta) args.push('--rosetta');
  // apply() verifies and pins a local image alias before stopping the VM.
  args.push(imageRef, ...(p.arguments ?? []));
  return args;
}
export function createResourceManager({ env = process.env, run = async (rt, args) => (await execute(rt, args, { env, timeout: 120_000, maxBuffer: 8 * MiB })).stdout, hostTotal = totalmem, hostFree = freemem } = {}) {
  const name = env.METOR_BOX_CONTAINER || 'metor-box';
  const json = async (rt, args) => JSON.parse(await run(rt, args));
  async function read(runtime, origin) {
    if (!['container', 'docker'].includes(runtime)) throw new Error('No supported local container runtime.');
    const info = (await json(runtime, ['inspect', name]))[0];
    const port = Number(new URL(origin).port || 80);
    const matches = runtime === 'container' ? info.configuration.publishedPorts?.some(p => p.containerPort === 6010 && p.hostPort === port) : info.NetworkSettings?.Ports?.['6010/tcp']?.some(p => Number(p.HostPort) === port);
    if (!matches) throw new Error('This connection does not match the local Space container.');
    const currentBytes = runtime === 'container' ? info.configuration.resources.memoryInBytes : info.HostConfig.Memory;
    let hostBytes = hostTotal(), otherBytes = 0;
    if (runtime === 'container') {
      const all = await json(runtime, ['list', '--format', 'json']);
      for (const x of all) if (x.id !== name && x.status?.state === 'running') otherBytes += x.configuration?.resources?.memoryInBytes ?? 0;
      appleCreateArgs(info, currentBytes); // Reject unsupported configurations before presenting Apply.
    } else {
      const daemon = await json(runtime, ['info', '--format', '{{json .}}']); hostBytes = daemon.MemTotal;
      if (process.platform !== 'linux' || !currentBytes) throw new Error('Live RAM increases require Docker on Linux with an existing memory limit.');
      const ids = (await run(runtime, ['ps', '-q'])).trim().split(/\s+/).filter(Boolean);
      if (ids.length) for (const x of await json(runtime, ['inspect', ...ids])) {
        if (x.Id === info.Id) continue;
        if (!x.HostConfig?.Memory) throw new Error('Another Docker container has no RAM limit. Set its limit before increasing this Space.');
        otherBytes += x.HostConfig.Memory;
      }
    }
    const reserveBytes = Math.max(2 * GiB, Math.ceil(hostBytes * 0.2 / MiB) * MiB);
    const maxBytes = Math.floor(Math.max(0, hostBytes - reserveBytes - otherBytes) / (256 * MiB)) * 256 * MiB;
    let savedMiB = null;
    try { savedMiB = Number((await readFile(settingsPath(env, runtime, name), 'utf8')).trim()); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    return { info, runtime, currentBytes, hostBytes, hostFreeBytes: hostFree(), reserveBytes, otherBytes, maxBytes, savedMiB, override: env.METOR_MEMORY || null, allowReduction: runtime === 'container', restartRequired: runtime === 'container' };
  }
  let busy = false;
  async function apply(runtime, origin, mib, { ready, progress = () => {} } = {}) {
    if (busy) throw new Error('A RAM change is already in progress.');
    busy = true;
    try {
      const state = await read(runtime, origin);
      if (state.override) throw new Error('METOR_MEMORY overrides saved settings. Remove that environment override and restart the app first.');
      validateAllocation(mib, state.currentBytes, state.maxBytes, runtime === 'container');
      const file = settingsPath(env, runtime, name);
      await mkdir(dirname(file), { recursive: true });
      // Verify persistence is writable before stopping anything.
      const pending = `${file}.pending`; await writeFile(pending, `${mib}\n`, { mode: 0o600 });
      if (runtime === 'container') {
        const image = state.info.configuration.image;
        const installed = (await json(runtime, ['image', 'inspect', image.reference]))[0];
        if (installed?.configuration?.descriptor?.digest !== image.descriptor.digest) throw new Error('The installed image tag has changed. Start the Space with the new image before changing RAM.');
        const pinned = `metor-resize-${name}:${image.descriptor.digest.replace('sha256:', '')}`;
        if (image.reference !== pinned) await run(runtime, ['image', 'tag', image.reference, pinned]);
        const verified = (await json(runtime, ['image', 'inspect', pinned]))[0];
        if (verified?.configuration?.descriptor?.digest !== image.descriptor.digest) throw new Error('Could not preserve the existing Space image.');
        const next = appleCreateArgs(state.info, mib * MiB, pinned), previous = appleCreateArgs(state.info, state.currentBytes, pinned);
        progress('Restarting the Space with the new RAM allocation…');
        await run(runtime, ['stop', name]);
        try {
          await run(runtime, ['delete', name]);
          await run(runtime, next);
          await run(runtime, ['start', name]);
          if (ready && !(await ready())) throw new Error('The Space did not become ready after the RAM change.');
          const actual = (await json(runtime, ['inspect', name]))[0].configuration.resources.memoryInBytes;
          if (actual !== mib * MiB) throw new Error('The runtime did not apply the requested RAM.');
          await rename(pending, file);
        } catch (error) {
          progress('Restoring the previous RAM allocation…');
          try { await run(runtime, ['stop', name]); } catch {}
          try { await run(runtime, ['delete', name]); } catch {}
          try { await run(runtime, previous); await run(runtime, ['start', name]); }
          catch { throw new Error('RAM change failed and the previous Space could not be restarted. Its persistent volumes are retained. Start the Space again from the app.'); }
          throw new Error('RAM change failed; the previous allocation was restored.');
        }
      } else {
        progress('Increasing the Docker memory limit…');
        const swap = state.info.HostConfig.MemorySwap;
        const args = ['update', '--memory', `${mib}m`];
        if (swap > 0) args.push('--memory-swap', String(swap + mib * MiB - state.currentBytes));
        args.push(name); await run(runtime, args);
        try {
          const actual = (await json(runtime, ['inspect', name]))[0].HostConfig.Memory;
          if (actual !== mib * MiB) throw new Error('Docker did not apply the requested RAM.');
          await rename(pending, file);
        } catch {
          const rollback = ['update', '--memory', String(state.currentBytes)];
          if (swap) rollback.push('--memory-swap', String(swap));
          rollback.push(name);
          await run(runtime, rollback);
          throw new Error('RAM setting could not be saved; the previous Docker limit was restored.');
        }
      }
      progress('RAM allocation saved.');
      return { ok: true };
    } finally { busy = false; }
  }
  return { read, apply };
}
