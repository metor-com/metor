import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, symlinkSync, linkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exportPackage, importPackage, validatePackage, packageFiles, portablePath } from './metor-bot-package.mjs';
const bot = { name: 'source', title: 'Source', role: 'Write useful notes.', harness: 'codex', model: 'default', autostart: false, sessionId: 'private-session', watchToken: 'private-token', reasoningEffort: 'high' };
const fixture = (t) => {
  const root = mkdtempSync(join(tmpdir(), 'metor-package-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'source/.metor'), { recursive: true });
  writeFileSync(join(root, 'source/bot.json'), JSON.stringify(bot));
  writeFileSync(join(root, 'source/notes.md'), 'A portable memory.');
  writeFileSync(join(root, 'source/.metor/routines.json'), JSON.stringify({ routines: [{ name: 'Daily note', cron: '0 9 * * *', prompt: 'Write a note', enabled: true, id: 'old-id' }] }));
  return root;
};
test('copy roundtrip keeps selected data, resets identity and pauses routines', (t) => {
  const root = fixture(t);
  const pkg = exportPackage(bot, { includeFiles: true, handoff: 'Next: review notes.' }, root);
  assert.equal(pkg.bot.sessionId, undefined); assert.equal(pkg.bot.watchToken, undefined);
  const copy = importPackage(pkg, { title: 'Copy' }, root);
  assert.equal(copy.name, 'copy'); assert.equal(copy.autostart, false); assert.equal(copy.sessionId, null);
  assert.equal(copy.reasoningEffort, 'high');
  assert.equal(readFileSync(join(root, 'copy/notes.md'), 'utf8'), 'A portable memory.');
  assert.match(readFileSync(join(root, 'copy/AGENTS.md'), 'utf8'), /handoff\.md/);
  const routine = JSON.parse(readFileSync(join(root, 'copy/.metor/routines.json'))).routines[0];
  assert.equal(routine.enabled, false); assert.equal(routine.nextRunAt, null); assert.notEqual(routine.id, 'old-id');
  writeFileSync(join(root, 'copy/notes.md'), 'Changed copy');
  assert.equal(readFileSync(join(root, 'source/notes.md'), 'utf8'), 'A portable memory.');
  assert.throws(() => importPackage(pkg, { title: 'Copy' }, root), /already exists/);
  assert.ok(!readdirSync(root).some((p) => p.startsWith('.import-')));
});
test('export listing and explicit export exclude links and runtime credentials', (t) => {
  const root = fixture(t);
  writeFileSync(join(root, 'source/.env'), 'SECRET=x');
  mkdirSync(join(root, 'source/.codex')); writeFileSync(join(root, 'source/.codex/auth.json'), 'private');
  symlinkSync('/etc/passwd', join(root, 'source/linked.txt'));
  linkSync(join(root, 'source/notes.md'), join(root, 'source/hard.txt'));
  assert.deepEqual(packageFiles('source', root), { files: [], directories: [] });
  assert.deepEqual(exportPackage(bot, {}, root).files, []);
});
test('hostile archives never create an imported bot', (t) => {
  const root = fixture(t), pkg = exportPackage(bot, { includeFiles: false }, root);
  for (const path of ['/tmp/leak', '../leak', 'a/../../leak', 'a\\b', '.ssh/key', '.metor/inbox.jsonl', 'bot.json', 'mcp.json', 'auth.pem', 'a//b', 'a/./b']) {
    assert.equal(portablePath(path), false, path);
    assert.throws(() => importPackage({ ...pkg, files: [{ path, data: 'eA==' }] }, { title: 'Attack' }, root));
  }
  assert.throws(() => validatePackage({ ...pkg, files: [{ path: 'a', data: 'eA==' }, { path: 'a/b', data: '' }] }), /Conflicting/);
  assert.throws(() => validatePackage({ ...pkg, files: [{ path: 'a', data: '' }, { path: 'A', data: '' }] }), /duplicate/);
  assert.throws(() => validatePackage({ ...pkg, files: [{ path: 'a', data: '%%%'}] }), /encoding/);
  assert.throws(() => validatePackage({ ...pkg, version: 99 }), /Unsupported/);
  assert.throws(() => validatePackage({ ...pkg, bot: { ...bot, harness: '__proto__' } }), /runtime/);
  assert.deepEqual(readdirSync(root), ['source']);
});
test('chat export includes only visible user and assistant text', (t) => {
  const root = fixture(t);
  writeFileSync(join(root, 'source/.metor/chat.jsonl'), [
    { role: 'user', text: 'Hello', attachments: [{ path: 'secret' }] },
    { role: 'assistant', kind: 'text', text: 'Hi', sessionId: 'secret' },
    { role: 'assistant', kind: 'tool', text: 'secret tool' },
    { role: 'assistant', kind: 'permission', text: 'secret permission' },
    { role: 'assistant', kind: 'error', text: 'secret error' },
  ].map(JSON.stringify).join('\n'));
  const pkg = exportPackage(bot, { includeFiles: false, conversation: true }, root);
  assert.deepEqual(pkg.conversation.map(({role,text}) => ({role,text})), [{ role: 'user', text: 'Hello' }, { role: 'assistant', text: 'Hi' }]);
  assert.equal(JSON.stringify(pkg).includes('secret'), false);
  assert.deepEqual(exportPackage(bot, { includeFiles: false }, root).conversation, []);
});
test('limits, corrupt routines and pre-existing non-bot directories are rejected', (t) => {
  const root = fixture(t), pkg = exportPackage(bot, { includeFiles: false }, root);
  assert.throws(() => validatePackage({ ...pkg, files: [{ path: 'large.bin', data: Buffer.alloc(26 * 1024 * 1024).toString('base64') }] }), /25 MiB/);
  assert.throws(() => validatePackage({ ...pkg, routines: [{ name: 'Bad', cron: 'no', prompt: 'test' }] }), /schedule/);
  mkdirSync(join(root, 'occupied'));
  assert.throws(() => importPackage(pkg, { title: 'Occupied' }, root), /already exists/);
});

test('all files by default, or none; preserves nested and empty directories', (t) => {
  const root = fixture(t);
  mkdirSync(join(root, 'source/empty'));
  mkdirSync(join(root, 'source/images'));
  writeFileSync(join(root, 'source/images/picture.png'), Buffer.from([0, 128, 255]));
  const pkg = exportPackage(bot, {}, root);
  assert.deepEqual(pkg.files.map((f) => f.path), ['images/picture.png', 'notes.md']);
  assert.ok(pkg.directories.includes('empty'));
  importPackage(pkg, { title: 'Copy' }, root);
  assert.deepEqual(readFileSync(join(root, 'copy/images/picture.png')), Buffer.from([0,128,255]));
  assert.deepEqual(readdirSync(join(root, 'copy/empty')), []);
  const none = exportPackage(bot, { includeFiles: false }, root);
  assert.deepEqual(none.files, []); assert.deepEqual(none.directories, []);
  writeFileSync(join(root, 'source/large.bin'), Buffer.alloc(26 * 1024 * 1024));
  assert.throws(() => exportPackage(bot, {}, root), /25 MiB/);
});

test('imported history is visible with original IDs and timestamps, without replaying turns', async (t) => {
  const { readHistory } = await import('./metor-chat-stream.mjs');
  const root = fixture(t), pkg = exportPackage(bot, { includeFiles: false }, root);
  pkg.conversation = [{ id: 'user-one', ts: '2026-09-01T12:34:56.000Z', role: 'user', text: 'Hello', status: 'sending', command: { name: 'delete' } }, { id: 'reply-one', ts: '2026-09-01T12:35:01.000Z', role: 'assistant', kind: 'text', text: 'Welcome' }];
  importPackage(pkg, { title: 'Visible' }, root);
  const history = readHistory(root, 'visible');
  assert.equal(history.length, 2); assert.equal(history[0].id, 'user-one'); assert.equal(history[0].ts, pkg.conversation[0].ts);
  assert.equal(history[0].status, 'delivered'); assert.equal(history[0].command, undefined);
  assert.ok(!readdirSync(join(root, 'visible/.metor')).includes('inbox.jsonl'));
  assert.deepEqual(readFileSync(join(root, 'visible/conversation.jsonl')), readFileSync(join(root, 'visible/.metor/chat.jsonl')));
  pkg.files = [{path:'conversation.jsonl',data:Buffer.from('Existing note').toString('base64')}];
  importPackage(pkg, {title:'Conflict'},root);
  assert.equal(readFileSync(join(root,'conflict/conversation.jsonl'),'utf8'),'Existing note');
  assert.ok(readdirSync(join(root,'conflict')).some(p=>/^conversation-.*\.jsonl$/.test(p)));
});
test('attachment links are retained only when their files travel with the bot', (t) => {
  const root = fixture(t), pkg = exportPackage(bot, {includeFiles:false},root);
  pkg.files = [{path:'uploads/image.png',data:Buffer.from([0,128,255]).toString('base64')}];
  pkg.conversation=[{id:'image',ts:'2026-09-01T12:00:00Z',role:'user',text:'Look',attachments:[{path:'uploads/image.png',name:'image.png',image:true},{path:'uploads/missing.png'}]}];
  assert.equal(validatePackage(pkg).conversation[0].attachments.length,1);
  assert.equal(validatePackage({...pkg,files:[]}).conversation[0].attachments,undefined);
});
test('portable collaboration history keeps peer origin and notices without importing live shared references; event routines remain paused', t => {
  const root=fixture(t);
  writeFileSync(join(root,'source/.metor/routines.json'),JSON.stringify({routines:[{name:'Review',trigger:{type:'event',source:'metor',event:'assignment.completed'},prompt:'Review result'}]}));
  writeFileSync(join(root,'source/.metor/chat.jsonl'),JSON.stringify({id:'result',role:'assistant',kind:'notice',origin:'bot',text:'Review complete',collaboration:{sender:'reviewer',assignmentId:'old-assignment',status:'completed',files:[{path:'private-other-space.txt'}]}})+'\n');
  const pkg=exportPackage(bot,{conversation:true},root);
  assert.equal(pkg.conversation[0].origin,'bot');assert.equal(pkg.conversation[0].collaboration.sender,'reviewer');
  assert.equal(pkg.conversation[0].collaboration.files,undefined);assert.equal(pkg.conversation[0].collaboration.historical,true);
  importPackage(pkg,{title:'Migrated'},root);
  const routine=JSON.parse(readFileSync(join(root,'migrated/.metor/routines.json'))).routines[0];
  assert.equal(routine.trigger.type,'event');assert.equal(routine.enabled,false);
});
