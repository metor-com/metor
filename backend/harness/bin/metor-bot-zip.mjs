// Use Python's standard ZIP implementation (included in the Space image).
// No archive entry is extracted to disk; the bot importer validates all paths before writes.
import { spawnSync } from 'node:child_process';
const script = String.raw`
import sys,json,zipfile,io,base64,stat
mode=sys.argv[1]
try:
 if mode=='encode':
  pkg=json.load(sys.stdin); files=pkg.pop('files'); dirs=pkg.pop('directories',[]); pkg['version']=4
  messages=pkg.pop('conversation',[]);conversation=''.join(json.dumps(m,ensure_ascii=False)+'\n' for m in messages);handoff=pkg.pop('handoff','')
  if conversation: pkg['conversationFile']='conversation.jsonl'
  if handoff: pkg['handoffFile']='handoff.md'
  out=io.BytesIO()
  with zipfile.ZipFile(out,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=6) as z:
   z.writestr('manifest.json',json.dumps(pkg,ensure_ascii=False))
   if conversation: z.writestr('conversation.jsonl',conversation.encode('utf-8'))
   if handoff: z.writestr('handoff.md',handoff.encode('utf-8'))
   for d in dirs: z.writestr('files/'+d+'/',b'')
   for f in files: z.writestr('files/'+f['path'],base64.b64decode(f['data'],validate=True))
  sys.stdout.buffer.write(out.getvalue())
 else:
  raw=sys.stdin.buffer.read(40*1024*1024+1)
  if len(raw)>40*1024*1024: raise ValueError('Package exceeds 40 MiB.')
  with zipfile.ZipFile(io.BytesIO(raw)) as z:
   entries=z.infolist()
   if len(entries)>2003: raise ValueError('Too many archive entries.')
   seen=set(); total=0; manifest=None; files=[]; dirs=[]; documents={}
   for i in entries:
    n=i.filename
    if n in seen: raise ValueError('Duplicate ZIP entry.')
    seen.add(n)
    kind=stat.S_IFMT(i.external_attr>>16)
    if kind not in (0,stat.S_IFREG,stat.S_IFDIR) or i.flag_bits&1 or i.compress_type not in (0,8): raise ValueError('Unsupported ZIP entry.')
    total+=i.file_size
    if total>29*1024*1024: raise ValueError('Expanded package exceeds 29 MiB.')
    if n=='manifest.json':
     if i.file_size>4*1024*1024: raise ValueError('Manifest is too large.')
     manifest=json.loads(z.read(i))
    elif n in ('conversation.jsonl','handoff.md'):
     if i.file_size>2*1024*1024: raise ValueError('Context document is too large.')
     documents[n]=z.read(i).decode('utf-8')
    elif n.startswith('files/'):
     if i.is_dir(): dirs.append(n[6:-1])
     else: files.append({'path':n[6:],'data':base64.b64encode(z.read(i)).decode('ascii')})
    else: raise ValueError('Unexpected archive entry.')
   if not isinstance(manifest,dict) or manifest.get('version')!=4 or 'files' in manifest or 'directories' in manifest: raise ValueError('Unsupported manifest.')
   if any(k in manifest for k in ('conversation','conversationMarkdown','handoff')): raise ValueError('Context must be stored in separate files.')
   for field,name,target in [('conversationFile','conversation.jsonl','conversation'),('handoffFile','handoff.md','handoff')]:
    reference=manifest.pop(field,None)
    if reference is not None and reference!=name: raise ValueError('Invalid context reference.')
    if (reference is not None)!=(name in documents): raise ValueError('Missing or unreferenced context file.')
    if name in documents: manifest[target]=[json.loads(line) for line in documents[name].splitlines() if line.strip()] if target=='conversation' else documents[name]
   manifest['version']=1;manifest['files']=files;manifest['directories']=dirs
   print(json.dumps(manifest))
except Exception as e:
 print(str(e),file=sys.stderr);sys.exit(1)
`;
function run(mode, input) {
  const r = spawnSync('python3', ['-c', script, mode], { input, maxBuffer: 80 * 1024 * 1024, timeout: 30000 });
  if (r.error || r.status !== 0) throw new Error(r.error ? 'Could not process bot archive.' : r.stderr.toString().trim() || 'Invalid bot archive.');
  return r.stdout;
}
export const encodeBotZip = (pkg) => run('encode', JSON.stringify(pkg));
export const decodeBotZip = (data) => JSON.parse(run('decode', data).toString('utf8'));
