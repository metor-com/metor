import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { encodeBotZip, decodeBotZip } from './metor-bot-zip.mjs';
const pkg = { format: 'metor-bot', version: 1, bot: { title: 'Test' }, files: [{ path: 'notes.md', data: Buffer.from('Some repeated text.\n'.repeat(100)).toString('base64') }], directories: ['empty'] };
test('standard ZIP contains real files, compresses text and roundtrips binary data', () => {
 const zip = encodeBotZip(pkg); assert.equal(zip.readUInt32LE(0), 0x04034b50); assert.ok(zip.length < 1000);
 assert.deepEqual(decodeBotZip(zip), pkg);
 const r = spawnSync('python3',['-c', "import sys,zipfile,io,json;z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())); assert 'files' not in json.loads(z.read('manifest.json')); assert z.read('files/notes.md').startswith(b'Some repeated text.'); assert z.getinfo('files/empty/').is_dir()"],{input:zip});
 assert.equal(r.status,0,r.stderr.toString());
});
test('reject corrupt ZIP, duplicate names, symlinks and excessive expanded size', () => {
 assert.throws(() => decodeBotZip(Buffer.from('not a zip')));
 for (const kind of ['duplicate','symlink','bomb']) {
  const r=spawnSync('python3',['-c',`import zipfile,io,sys,stat
b=io.BytesIO()
with zipfile.ZipFile(b,'w',compression=zipfile.ZIP_DEFLATED) as z:
 z.writestr('manifest.json','{"version":2}')
 if sys.argv[1]=='duplicate': z.writestr('manifest.json','{}')
 if sys.argv[1]=='symlink':
  i=zipfile.ZipInfo('files/link');i.external_attr=(stat.S_IFLNK|0o777)<<16;z.writestr(i,'/etc/passwd')
 if sys.argv[1]=='bomb': z.writestr('files/large',b'x'*(30*1024*1024))
sys.stdout.buffer.write(b.getvalue())`,kind],{maxBuffer:1024*1024});
  assert.equal(r.status,0);assert.throws(()=>decodeBotZip(r.stdout));
 }
});

test('conversation JSONL and handoff are separate from the manifest', () => {
 const input = { ...pkg, conversation: [{ role: 'user', text: 'Hello' }, { role: 'assistant', text: 'Hello **back**.' }], handoff: 'Continue here.' };
 const zip = encodeBotZip(input);
 const r = spawnSync('python3', ['-c', "import sys,zipfile,io,json;z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read()));m=json.loads(z.read('manifest.json'));assert m['version']==4;assert 'conversation' not in m and 'handoff' not in m;assert m['conversationFile']=='conversation.jsonl';assert b'Hello **back**.' in z.read('conversation.jsonl');assert z.read('handoff.md')==b'Continue here.'"], {input:zip});
 assert.equal(r.status,0,r.stderr.toString());
 const decoded=decodeBotZip(zip);assert.deepEqual(decoded.conversation,input.conversation);assert.equal(decoded.handoff,input.handoff);
});
test('previous ZIP package format is rejected', () => {
 const old={...pkg,version:2,conversation:[{role:'user',text:'Old conversation'}],handoff:''};delete old.files;delete old.directories;
 const r=spawnSync('python3',['-c',"import sys,io,json,zipfile;b=io.BytesIO();z=zipfile.ZipFile(b,'w');z.writestr('manifest.json',sys.stdin.read());z.close();sys.stdout.buffer.write(b.getvalue())"],{input:JSON.stringify(old)});
 assert.throws(() => decodeBotZip(r.stdout), /Unsupported manifest/);
});
