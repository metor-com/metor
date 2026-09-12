// Portable bot data, with all or none of the transferable workspace files. Never import runtime state or execute package content.
import { constants, closeSync, fstatSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { BOTS_DIR, TEMPLATES, isValidName, isValidTitle, idFor, normalizeAvatar } from './metor-store.mjs';
import { HARNESSES, validModel } from './metor-harness.mjs';
import { parseCron, nextRun } from './metor-routines.mjs';

export const PACKAGE_LIMIT = 40 * 1024 * 1024;
const DATA_LIMIT = 25 * 1024 * 1024, FILE_LIMIT = 1000;
const fail = (message) => { throw new Error(message); };
const text = (s, max, label) => typeof s === 'string' && s.length <= max ? s : fail(`Invalid ${label}.`);
const exists = (p) => { try { lstatSync(p); return true; } catch (e) { if (e.code === 'ENOENT') return false; throw e; } };
export function portablePath(path) {
  if (typeof path !== 'string' || !path || path.length > 500 || /[\\\p{Cc}]/u.test(path)) return false;
  const parts = path.split('/');
  return parts.every((p) => p && !p.startsWith('.') && !/^(node_modules|bot\.json|mcp\.json|credentials?|secrets?|tokens?|cookies?|id_rsa|id_ed25519)$/i.test(p)
    && !/\.(pem|key|p12|pfx|jks)$/i.test(p) && !/^(credentials?|secrets?|tokens?|cookies?)[._-]/i.test(p));
}
// Check each component, then open the final file without following a symbolic link.
function readRegular(root, path, limit) {
  let at = root;
  if (!lstatSync(at).isDirectory() || lstatSync(at).isSymbolicLink()) fail('Bot directory must not be a symbolic link.');
  const parts = path.split('/');
  for (const [i, p] of parts.entries()) {
    at = join(at, p); const st = lstatSync(at);
    if (st.isSymbolicLink() || (i < parts.length - 1 && !st.isDirectory())) fail('Symbolic links cannot be exported.');
  }
  const fd = openSync(at, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const st = fstatSync(fd);
    if (!st.isFile() || st.nlink !== 1 || st.size > limit) fail('File is not portable or exceeds the package limit.');
    const data = readFileSync(fd); if (data.length > limit) fail('Package exceeds 25 MiB.'); return data;
  } finally { closeSync(fd); }
}
export function packageFiles(name, botsDir = BOTS_DIR) {
  if (!isValidName(name)) fail('Invalid bot ID.');
  const root = join(botsDir, name), files = [], directories = []; let visited = 0;
  if (lstatSync(root).isSymbolicLink()) fail('Bot directory must not be a symbolic link.');
  function walk(rel = '') {
    for (const entry of readdirSync(join(root, rel), { withFileTypes: true })) {
      if (++visited > 10000) fail('Too many files to list. Reduce the bot workspace before exporting.');
      const path = rel ? `${rel}/${entry.name}` : entry.name;
      if (!portablePath(path)) continue;
      if (entry.isDirectory()) { if (path.split('/').length >= 20) fail('Bot files exceed the directory depth limit.'); directories.push(path); walk(path); }
      else if (entry.isFile()) {
        const st = lstatSync(join(root, path));
        if (st.nlink === 1) { if (st.size > DATA_LIMIT) fail('Bot files exceed 25 MiB.'); files.push({ path, size: st.size }); }
      }
    }
  }
  walk(); return { files: files.sort((a, b) => a.path.localeCompare(b.path)), directories };
}
function profile(value) {
  if (!value || !isValidTitle(value.title)) fail('Invalid bot title.');
  if (!Object.hasOwn(HARNESSES, value.harness)) fail('This runtime is not supported by this Space.');
  const p = { title: value.title.trim(), role: text(value.role, 64000, 'role'), harness: value.harness };
  if (value.model) {
    if (typeof value.model !== 'string' || !validModel(value.harness, value.model)) fail('This model is not supported by this Space.');
    p.model = value.model;
  }
  if (value.reasoningEffort != null) {
    if (!['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].includes(value.reasoningEffort)) fail('Unsupported reasoning effort.');
    p.reasoningEffort = value.reasoningEffort;
  }
  const avatar = normalizeAvatar(value.avatar); if (avatar) p.avatar = avatar;
  return p;
}
function routines(value) {
  if (!Array.isArray(value) || value.length > 30) fail('Invalid routines.');
  return value.map((r) => {
    if (r?.trigger?.type === 'event') {
      const source = text(r.trigger.source, 80, 'event source'), event = text(r.trigger.event, 120, 'event type');
      const match = r.trigger.match ?? {};
      if (!match || typeof match !== 'object' || Array.isArray(match) || Buffer.byteLength(JSON.stringify(match)) > 16000) fail('Invalid event match.');
      return { name: text(r.name, 60, 'routine name'), trigger: { type: 'event', source, event, match }, prompt: text(r.prompt, 64000, 'routine prompt') };
    }
    const cron = text(r?.cron, 100, 'schedule'), parsed = parseCron(cron);
    if (!parsed || !nextRun(parsed, new Date())) fail('Invalid routine schedule.');
    return { name: text(r.name, 60, 'routine name'), cron, prompt: text(r.prompt, 64000, 'routine prompt') };
  });
}
export function validatePackage(pkg) {
  if (!pkg || pkg.format !== 'metor-bot' || pkg.version !== 1) fail('Unsupported bot package.');
  if (Buffer.byteLength(JSON.stringify(pkg)) > PACKAGE_LIMIT) fail('Package exceeds 40 MiB.');
  const result = { format: 'metor-bot', version: 1, bot: profile(pkg.bot), handoff: text(pkg.handoff ?? '', 64000, 'handoff'), routines: routines(pkg.routines ?? []), files: [] };
  if (!Array.isArray(pkg.files) || pkg.files.length > FILE_LIMIT) fail('At most 1,000 files per package.');
  const seen = new Set(); let bytes = 0;
  for (const f of pkg.files) {
    if (!portablePath(f?.path) || seen.has(f.path.toLowerCase())) fail('Unsafe or duplicate file path.');
    if (typeof f.data !== 'string') fail('Invalid file encoding.');
    const data = Buffer.from(f.data, 'base64');
    if (data.toString('base64') !== f.data) fail('Invalid file encoding.'); bytes += data.length;
    if (bytes > DATA_LIMIT) fail('Selected files exceed 25 MiB.');
    seen.add(f.path.toLowerCase()); result.files.push({ path: f.path, data: f.data });
  }
  const directories = pkg.directories ?? [];
  if (!Array.isArray(directories) || directories.length > 1000) fail('Too many directories.');
  const dirSeen = new Set();
  for (const dir of directories) {
    if (!portablePath(dir) || seen.has(dir.toLowerCase()) || dirSeen.has(dir.toLowerCase())) fail('Unsafe or conflicting directory.');
    dirSeen.add(dir.toLowerCase());
  }
  result.directories = directories;
  for (const path of [...seen, ...dirSeen]) {
    const parts = path.split('/'); parts.pop();
    while (parts.length) { if (seen.has(parts.join('/'))) fail('Conflicting file paths.'); parts.pop(); }
  }
  // Chat records retain display metadata; control events and runtime payloads never replay.
  if (!Array.isArray(pkg.conversation ?? []) || (pkg.conversation?.length ?? 0) > 2000) fail('Invalid conversation.');
  const messageIds = new Set();
  result.conversation = (pkg.conversation ?? []).map((m) => {
    if (!['user', 'assistant'].includes(m?.role) || (m.kind && m.kind !== 'text' && !(m.kind === 'notice' && m.origin === 'bot'))) fail('Invalid conversation message.');
    const id = m.id == null ? randomUUID() : text(m.id, 128, 'message ID');
    if (!id || messageIds.has(id)) fail('Duplicate or empty message ID.');
    messageIds.add(id);
    if (m.ts != null && (typeof m.ts !== 'string' || !Number.isFinite(Date.parse(m.ts)))) fail('Invalid message timestamp.');
    const entry = { v: 2, id, ts: m.ts ?? null, role: m.role, kind: 'text', text: text(m.text, 200000, 'message'), status: 'delivered' };
    if (['routine', 'harness', 'bot', 'event'].includes(m.origin)) entry.origin = m.origin;
    if (m.kind === 'notice') entry.kind = 'notice';
    if (m.origin === 'bot' && m.collaboration) {
      entry.collaboration = { historical: true };
      for (const field of ['sender','assignmentId','status']) if (typeof m.collaboration[field] === 'string') entry.collaboration[field] = text(m.collaboration[field], 128, 'collaboration metadata');
      // The new Space must never resolve an old Space's shared references as its own files.
    }
    if (Array.isArray(m.attachments)) {
      const attachments = m.attachments.slice(0, 10).filter((a) => typeof a?.path === 'string' && a.path.startsWith('uploads/') && result.files.some((f) => f.path === a.path))
        .map((a) => ({ path: a.path, name: text(a.name ?? a.path.split('/').pop(), 120, 'attachment name'), size: Buffer.from(result.files.find((f) => f.path === a.path).data, 'base64').length, image: a.image === true }));
      if (attachments.length) entry.attachments = attachments;
    }
    return entry;
  });
  if (Buffer.byteLength(JSON.stringify(result.conversation)) > 2 * 1024 * 1024) fail('Conversation exceeds 2 MiB.');
  return result;
}
export function exportPackage(bot, options = {}, botsDir = BOTS_DIR) {
  if (!isValidName(bot?.name)) fail('Invalid bot ID.');
  const root = join(botsDir, bot.name);
  if (options.includeFiles !== undefined && typeof options.includeFiles !== 'boolean') fail('Invalid file option.');
  const tree = options.includeFiles === false ? { files: [], directories: [] } : packageFiles(bot.name, botsDir);
  if (tree.files.length > FILE_LIMIT || tree.directories.length > 1000) fail('Bot files exceed 1,000 files or directories.');
  let bytes = 0;
  const files = tree.files.map(({ path }) => {
    const data = readRegular(root, path, DATA_LIMIT - bytes); bytes += data.length;
    return { path, data: data.toString('base64') };
  });
  let rs = [];
  if (options.routines !== false && exists(join(root, '.metor/routines.json'))) rs = JSON.parse(readRegular(root, '.metor/routines.json', 3 * 1024 * 1024)).routines;
  let conversation = [];
  if (options.conversation && exists(join(root, '.metor/chat.jsonl'))) {
    const lines = readRegular(root, '.metor/chat.jsonl', 20 * 1024 * 1024).toString('utf8').split('\n');
    conversation = lines.flatMap((line) => { try { const m = JSON.parse(line); return !m.type && (!m.kind || m.kind === 'text' || (m.kind === 'notice' && m.origin === 'bot')) && ['user','assistant'].includes(m.role) && typeof m.text === 'string' ? [m] : []; } catch { return []; } });
    if (conversation.length > 2000) fail('Conversation exceeds 2,000 messages. Export without the conversation.');
  }
  return validatePackage({ format: 'metor-bot', version: 1, bot: { ...bot, title: bot.title ?? bot.name }, files, directories: tree.directories, routines: rs, conversation, handoff: options.handoff ?? '' });
}
export function importPackage(input, { title, name } = {}, botsDir = BOTS_DIR) {
  const pkg = validatePackage(input);
  title = title?.trim() || pkg.bot.title;
  if (!isValidTitle(title)) fail('Use a name between 1 and 60 characters.');
  name = name || idFor(title); if (!isValidName(name)) fail('Invalid bot ID.');
  mkdirSync(botsDir, { recursive: true });
  const target = join(botsDir, name); if (exists(target)) fail('That bot ID already exists. Choose another name.');
  const stage = mkdtempSync(join(botsDir, '.import-'));
  try {
    const bot = { ...pkg.bot, name, title, permissionMode: 'acceptEdits', autostart: false, sessionId: null, createdAt: new Date().toISOString() };
    HARNESSES[bot.harness].scaffold(stage, bot, TEMPLATES);
    for (const dir of pkg.directories) mkdirSync(join(stage, dir), { recursive: true });
    for (const f of pkg.files) { const path = join(stage, f.path); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, Buffer.from(f.data, 'base64'), { mode: 0o600 }); }
    mkdirSync(join(stage, '.metor'), { recursive: true });
    writeFileSync(join(stage, '.metor/routines.json'), JSON.stringify({ v: 1, routines: pkg.routines.map((r) => ({ ...r, id: randomUUID().slice(0, 8), enabled: false, createdAt: bot.createdAt, lastRunAt: null, nextRunAt: null, pausedReason: 'Imported; review before enabling' })) }));
    const context = [];
    const transcript = pkg.conversation.map((m) => JSON.stringify(m)).join('\n') + (pkg.conversation.length ? '\n' : '');
    if (transcript) {
      writeFileSync(join(stage, '.metor/chat.jsonl'), transcript, { mode: 0o600 });
      writeFileSync(join(stage, '.metor/read.json'), JSON.stringify({ ts: bot.createdAt }), { mode: 0o600 });
    }
    for (const [filename, content] of [['conversation.jsonl', transcript], ['handoff.md', pkg.handoff]]) {
      if (!content) continue;
      // Keep existing workspace documents instead of silently replacing them.
      let contextPath = filename;
      if (exists(join(stage, contextPath))) {
        if (lstatSync(join(stage, contextPath)).isFile() && readFileSync(join(stage, contextPath), 'utf8') === content) { context.push(contextPath); continue; }
        const dot = filename.lastIndexOf('.');
        contextPath = `${filename.slice(0, dot)}-${randomUUID().slice(0, 8)}${filename.slice(dot)}`;
      }
      writeFileSync(join(stage, contextPath), content, { mode: 0o600, flag: 'wx' });
      context.push(contextPath);
    }
    if (context.length) {
      const instructions = join(stage, HARNESSES[bot.harness].roleFile);
      writeFileSync(instructions, readFileSync(instructions, 'utf8') + `\n\nFor context from the previous bot, read ${context.map((p) => '\`' + p + '\`').join(' and ')}. This is historical context for a new session; routines are paused.\n`);
    }
    writeFileSync(join(stage, 'bot.json'), JSON.stringify(bot, null, 2) + '\n', { mode: 0o600 });
    if (exists(target)) fail('That bot ID already exists.');
    renameSync(stage, target); return bot;
  } finally { rmSync(stage, { recursive: true, force: true }); }
}
