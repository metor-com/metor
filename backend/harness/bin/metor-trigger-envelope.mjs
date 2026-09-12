import { randomUUID } from 'node:crypto';
const object = value => value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
function string(value, field, max) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`Invalid event ${field}`);
  return value.trim();
}
function validateData(value, depth = 0) {
  if (depth > 20) throw new Error('Event data is nested too deeply');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (Array.isArray(value)) { for (const item of value) validateData(item, depth + 1); return; }
  if (!object(value)) throw new Error('Event data must be JSON values');
  for (const [key,item] of Object.entries(value)) {
    if (['__proto__','constructor','prototype'].includes(key)) throw new Error('Unsafe event data key');
    validateData(item, depth + 1);
  }
}
export function normalizeTriggerEvent(input = {}) {
  if (!object(input) || (input.v !== undefined && input.v !== 1)) throw new Error('Invalid event envelope version');
  const event = { v: 1, id: string(input.id ?? randomUUID(), 'id', 240), source: string(input.source, 'source', 80), type: string(input.type, 'type', 120), occurredAt: input.occurredAt ?? new Date().toISOString(), receivedAt: new Date().toISOString(), subject: input.subject ?? {}, data: input.data ?? {} };
  if (!object(event.subject) || !object(event.data) || typeof event.occurredAt !== 'string' || !Number.isFinite(Date.parse(event.occurredAt))) throw new Error('Invalid event data or timestamp');
  validateData(event.subject); validateData(event.data);
  if (input.cursor !== undefined) event.cursor = string(input.cursor, 'cursor', 500);
  if (Buffer.byteLength(JSON.stringify(event)) > 256 * 1024) throw new Error('event exceeds 256 KiB');
  return event;
}
