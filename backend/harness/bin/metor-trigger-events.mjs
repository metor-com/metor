// Durable event fan-out. SQLite WAL checkpoint/rotation cannot discard pending rows.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { transaction, stableId } from './metor-durable.mjs';
import { readRoutines } from './metor-routines.mjs';
import { normalizeTriggerEvent } from './metor-trigger-envelope.mjs';
export { normalizeTriggerEvent } from './metor-trigger-envelope.mjs';
export function publishTriggerEvent(botsDir, input) {
  const event = normalizeTriggerEvent(input);
  return transaction(botsDir, s => {
    const key = stableId(event.source, event.id), old = s.get('events', key);
    if (old) {
      const payload = e => ({ ...e, receivedAt: null });
      // Caller retries may omit occurredAt; preserve the first accepted timestamp.
      if (input.occurredAt === undefined) event.occurredAt = old.event.occurredAt;
      if (JSON.stringify(payload(old.event)) !== JSON.stringify(payload(event))) throw new Error('Event ID reused with different data');
      return old.event;
    }
    s.put('events', key, { event, planned: false }); return event;
  });
}
const object = v => v && typeof v === 'object' && !Array.isArray(v) ? v : {};
function valueAt(value, path) { return path.split('.').reduce((at, key) => Object.hasOwn(object(at), key) ? at[key] : undefined, value); }
const matches = (a,b) => Array.isArray(b) ? b.includes(a) : a === b;
export function triggerMatchesEvent(trigger, event) {
  return trigger?.type === 'event' && trigger.source === event.source && (!trigger.event || matches(event.type, trigger.event)) && Object.entries(object(trigger.match)).every(([p,v]) => matches(valueAt(event,p),v));
}
// Preserve the recoverable part of the earlier, uncommitted JSONL foundation on upgrade.
function importLegacy(root, s) {
  if (s.get('migration', 'events-jsonl')) return;
  let seen = [];
  try { seen = JSON.parse(readFileSync(join(root, '.events/receipts.json'), 'utf8')).ids ?? []; } catch (e) { if (e.code !== 'ENOENT') throw e; }
  for (const file of ['events.jsonl.1','events.jsonl']) {
    let raw; try { raw = readFileSync(join(root, '.events', file), 'utf8'); } catch (e) { if (e.code === 'ENOENT') continue; throw e; }
    for (const line of raw.split('\n').filter(Boolean)) {
      const event = normalizeTriggerEvent(JSON.parse(line)), key = stableId(event.source,event.id);
      if (!s.get('events',key)) s.put('events',key,{event,planned:false,legacyReceipts:seen});
    }
  }
  s.put('migration','events-jsonl',{done:true});
}
export function drainTriggerEvents(root, bots, fire) {
  transaction(root, s => {
    importLegacy(root,s);
    for (const row of s.rows('events', true)) {
      for (const bot of bots) for (const routine of readRoutines(root,bot.name)) {
        if (!routine.enabled || !triggerMatchesEvent(routine.trigger,row.event)) continue;
        const id = stableId('event-turn',row.event.source,row.event.id,bot.name,routine.id);
        const legacy = row.legacyReceipts?.includes(`${row.event.id}\0${bot.name}\0${routine.id}`);
        const correlationId = row.event.data?.correlationId ?? row.event.id;
        const chain = s.get('chains',correlationId) ?? {count:0};
        const depth = (row.event.data?.depth ?? 0) + 1;
        const limited = chain.count >= 12 || depth > 6;
        if (!legacy && !limited) { chain.count++; s.put('chains',correlationId,chain); }
        s.put('event-deliveries',id,{bot,routine,event:row.event,done:!!legacy || limited, ...(limited ? {error:'Bot event chain limit reached'} : {}), collaboration:{correlationId,depth,sender:'metor'}});
      }
      s.put('events',row.id,{...row,planned:true});
    }
  });
  const pending = transaction(root,s => s.rows('event-deliveries', true));
  const fired = [];
  for (const d of pending) {
    try {
      // All callers MUST pass this stable ID to injectTurn. A crash after fire replays
      // this callback, while the durable inbox insertion remains idempotent.
      fire(d.bot,d.routine,d.event,{id:d.id,collaboration:d.collaboration});
      transaction(root,s => s.put('event-deliveries',d.id,{...d,done:true,error:null}));
      fired.push({bot:d.bot.name,routine:d.routine.id,event:d.event.id});
    } catch (e) { transaction(root,s => s.put('event-deliveries',d.id,{...d,error:e.message})); }
  }
  return fired;
}
