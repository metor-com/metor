// One fixed host-selected bot identity per stdio MCP process, across every runtime.
import { createInterface } from 'node:readline';
import { collaborationCall, readLocalBot, deliverOutbox } from './metor-collaboration.mjs';
const root = process.env.METOR_BOTS_DIR ?? '/workspace/bots';
const sender = process.argv[2];
readLocalBot(root, sender);
const str = description => ({ type: 'string', description });
const request = str('Unique operation ID. Reuse unchanged when retrying; never reuse for another operation.');
const specs = [
  ['list_bots','List bots in this Space, including paused bots and their status.',{},[]],
  ['send_to_bot','Durably send information to another bot. Paused bots wait for the user to start them.',{to:str('Recipient bot name'),text:str('Message'),request_id:request},['to','text','request_id']],
  ['assign_task','Delegate a goal. Results return durably; do not poll in a loop.',{to:str('Recipient bot name'),goal:str('Concrete goal and success criteria'),request_id:request},['to','goal','request_id']],
  ['get_assignment','Read an assignment involving this bot.',{id:str('Assignment ID')},['id']],
  ['report_assignment','Explicitly report a result or blockage. Ending a turn does not complete an assignment.',{id:str('Assignment ID'),status:{type:'string',enum:['working','blocked','completed','failed']},result:str('Result or reason for blockage/failure'),files:{type:'array',items:str('Path relative to the Space shared directory'),maxItems:20},request_id:request},['id','status','request_id']],
];
export const tools = specs.map(([name,description,properties,required]) => ({name,description,inputSchema:{type:'object',properties,required,additionalProperties:false}}));
const reply = obj => process.stdout.write(JSON.stringify({jsonrpc:'2.0',...obj})+'\n');
const lines = createInterface({input:process.stdin});
lines.on('line', line => {
  if (Buffer.byteLength(line) > 256*1024) { reply({id:null,error:{code:-32600,message:'Request too large'}}); return; }
  let msg;
  try { msg=JSON.parse(line); } catch { reply({id:null,error:{code:-32700,message:'Invalid JSON'}}); return; }
  if (msg.id === undefined) return;
  try {
    let result;
    if (msg.method==='initialize') result={protocolVersion:'2024-11-05',capabilities:{tools:{}},serverInfo:{name:'metor',version:'1.0.0'}};
    else if (msg.method==='ping') result={};
    else if (msg.method==='tools/list') result={tools};
    else if (msg.method==='tools/call') {
      try {
        const value=collaborationCall(root,sender,msg.params?.name,msg.params?.arguments ?? {});
        // Opportunistic low-latency delivery; supervisor retries all remaining outbox rows.
        deliverOutbox(root);
        result={content:[{type:'text',text:JSON.stringify(value)}]};
      } catch(e) { result={isError:true,content:[{type:'text',text:e.message}]}; }
    } else { reply({id:msg.id,error:{code:-32601,message:'Unknown method'}}); return; }
    reply({id:msg.id,result});
  } catch(e) { reply({id:msg.id,error:{code:-32603,message:e.message}}); }
});
