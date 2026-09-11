// Space-level admission for runtime starts. Running work is never killed by this guard.
import { readFileSync, mkdirSync, writeFileSync, renameSync, rmSync, statSync } from 'node:fs';
import { join, dirname, relative, resolve } from 'node:path';
import { totalmem, freemem, platform } from 'node:os';
import { BOTS_DIR, botDir, readBot } from './metor-store.mjs';
const MiB = 1024 * 1024;
const read = file => { try { return readFileSync(file, 'utf8').trim(); } catch { return null; } };
const numeric = value => value !== null && value !== '' && Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : null;

export function memorySnapshot({ readText = read, os = platform(), total = totalmem, free = freemem } = {}) {
  let totalBytes, availableBytes, source = 'system';
  if (os === 'linux') {
    const info = readText('/proc/meminfo') ?? '';
    totalBytes = Number(info.match(/^MemTotal:\s+(\d+) kB/m)?.[1]) * 1024;
    availableBytes = Number(info.match(/^MemAvailable:\s+(\d+) kB/m)?.[1]) * 1024;
    if (!Number.isFinite(totalBytes) || !Number.isFinite(availableBytes)) return { available: false, reason: 'memory_unavailable' };
    // Respect the current cgroup and every visible ancestor (including nested limits).
    const memberships = (readText('/proc/self/cgroup') ?? '').split('\n');
    const mounts = (readText('/proc/self/mountinfo') ?? '').split('\n');
    const decode = s => s.replace(/\\(\d{3})/g, (_, n) => String.fromCharCode(parseInt(n, 8)));
    const candidates = new Map([['/sys/fs/cgroup', 2], ['/sys/fs/cgroup/memory', 1]]);
    for (const line of mounts) {
      const [left, right] = line.split(' - '); if (!right) continue;
      const fs = right.split(' '), fields = left.split(' ');
      const v = fs[0] === 'cgroup2' ? 2 : fs[0] === 'cgroup' && fs[2]?.split(',').includes('memory') ? 1 : 0;
      if (!v) continue;
      const member = memberships.find(s => v === 2 ? s.startsWith('0::') : s.split(':')[1]?.split(',').includes('memory'));
      if (!member) continue;
      const root = decode(fields[3]), mount = decode(fields[4]), group = member.split(':').slice(2).join(':');
      const suffix = group === '/' ? '' : relative(root, group);
      let current = resolve(mount, suffix);
      if (current !== mount && !current.startsWith(mount + '/')) continue;
      for (;;) { candidates.set(current, v); if (current === mount) break; current = dirname(current); }
    }
    for (const [dir, v] of candidates) {
      const limit = numeric(readText(join(dir, v === 2 ? 'memory.max' : 'memory.limit_in_bytes')));
      if (limit === null || limit > Number.MAX_SAFE_INTEGER) continue;
      const current = numeric(readText(join(dir, v === 2 ? 'memory.current' : 'memory.usage_in_bytes')));
      if (current === null) return { available: false, reason: 'memory_unavailable' };
      const stats = readText(join(dir, 'memory.stat')) ?? '';
      const key = v === 2 ? 'inactive_file' : 'total_inactive_file';
      const cached = Number(stats.match(new RegExp(`^${key}\\s+(\\d+)$`, 'm'))?.[1] ?? 0);
      // Reclaimable file cache must not leave idle bots waiting forever for an
      // allocation that would itself trigger reclamation. Physical MemAvailable
      // remains a second, independent bound.
      const working = Math.max(0, current - Math.min(current, cached));
      totalBytes = Math.min(totalBytes, limit);
      availableBytes = Math.min(availableBytes, Math.max(0, limit - working));
      source = 'container';
    }
  } else { totalBytes = total(); availableBytes = free(); }
  if (!(totalBytes > 0) || !Number.isFinite(availableBytes)) return { available: false, reason: 'memory_unavailable' };
  availableBytes = Math.max(0, Math.min(totalBytes, availableBytes));
  const reserveBytes = Math.max(256 * MiB, Math.min(1024 * MiB, totalBytes * .1));
  const startBytes = 512 * MiB;
  return { available: true, totalBytes, availableBytes, usedBytes: totalBytes - availableBytes, reserveBytes, startBytes,
    requiredBytes: reserveBytes + startBytes, low: availableBytes < reserveBytes + startBytes, source, sampledAt: new Date().toISOString() };
}
function identity(pid) {
  const stat = read(`/proc/${pid}/stat`);
  return { pid, start: stat?.slice(stat.lastIndexOf(')') + 2).split(' ')[19] ?? null, boot: read('/proc/sys/kernel/random/boot_id') };
}
function alive(owner) {
  if (!owner?.pid) return false;
  try { process.kill(owner.pid, 0); } catch { return false; }
  const now = identity(owner.pid);
  return (!owner.start || now.start === owner.start) && (!owner.boot || now.boot === owner.boot);
}
function queuedAlive(item) {
  if (!item.kind || item.kind === 'runtime') return alive(item);
  try { return readBot(item.name).autostart && JSON.parse(readFileSync(join(botDir(item.name), '.desktop', 'demand.json'), 'utf8'))[item.kind] === true; } catch { return false; }
}
const sameRequest = (item, name, kind, pid) => item.name === name && (item.kind ?? 'runtime') === kind && (kind !== 'runtime' || item.pid === pid);
const leased = lease => lease && (lease.until ? lease.until > Date.now() : (!lease.expiresAt || lease.expiresAt > Date.now()) && alive(lease));
export function createMemoryGuard({ root = join(BOTS_DIR, '.memory'), sample = memorySnapshot } = {}) {
  const file = join(root, 'admission.json'), lock = join(root, 'lock'), owner = identity(process.pid);
  const load = () => { const raw = read(file); return raw ? JSON.parse(raw) : { queue: [], lease: null }; };
  function transaction(fn) {
    mkdirSync(root, { recursive: true });
    try { mkdirSync(lock); } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      const record = read(join(lock, 'owner.json'));
      try { if (record ? !alive(JSON.parse(record)) : Date.now() - statSync(lock).mtimeMs > 10000) rmSync(lock, { recursive: true, force: true }); } catch {}
      return null;
    }
    try {
      writeFileSync(join(lock, 'owner.json'), JSON.stringify(owner));
      const state = load();
      state.queue = state.queue.filter(queuedAlive);
      if (state.lease && !leased(state.lease)) state.lease = null;
      const result = fn(state);
      const tmp = `${file}.${process.pid}.tmp`; writeFileSync(tmp, JSON.stringify(state)); renameSync(tmp, file);
      return result;
    } finally { rmSync(lock, { recursive: true, force: true }); }
  }
  return {
    request(name, { kind = 'runtime', startBytes = null } = {}) {
      try { return transaction(state => {
        if (!state.queue.some(x => sameRequest(x, name, kind, owner.pid))) state.queue.push({ ...owner, name, kind, since: Date.now() });
        const raw = sample();
        const memory = raw.available && startBytes !== null ? { ...raw, startBytes, requiredBytes: raw.reserveBytes + startBytes, low: raw.availableBytes < raw.reserveBytes + startBytes } : raw;
        if (!memory.available) return { admitted: false, reason: 'memory_unavailable', memory };
        if (memory.low) return { admitted: false, reason: 'low_memory', memory };
        if (state.lease || !state.queue[0] || !sameRequest(state.queue[0], name, kind, owner.pid)) return { admitted: false, reason: 'startup_queue', memory };
        state.lease = { ...owner, name, kind, since: Date.now(), ...(kind !== "runtime" ? { expiresAt: Date.now() + 60000 } : {}) }; state.queue.shift();
        return { admitted: true, memory };
      }) ?? { admitted: false, reason: 'startup_queue' }; }
      catch (e) { console.error('Memory guard unavailable:', e.message); return { admitted: false, reason: 'memory_unavailable' }; }
    },
    release(name, kind = 'runtime', cooldownMs = 0) {
      try { return transaction(state => {
        if (state.lease?.pid === owner.pid && sameRequest(state.lease, name, kind, owner.pid)) state.lease = cooldownMs ? { ...state.lease, until: Date.now() + cooldownMs } : state.lease.until > Date.now() ? state.lease : null;
        state.queue = state.queue.filter(x => !sameRequest(x, name, kind, owner.pid));
        return true;
      }) ?? false; } catch (e) { console.error('Memory guard release failed:', e.message); return false; }
    },
    snapshot() {
      const memory = sample();
      try { const state = load(); return { ...memory, waiting: state.queue.filter(queuedAlive).map(x => ({ name: x.name, kind: x.kind ?? "runtime", since: x.since })), starting: leased(state.lease) ? state.lease.name : null }; }
      catch { return { ...memory, waiting: [], starting: null, coordinationError: true }; }
    },
  };
}
