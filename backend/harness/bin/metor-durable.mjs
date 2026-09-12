// Space-local transactions, no daemon. Node >=22.13 (the box uses Node 22).
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, openSync, closeSync, fsyncSync, readFileSync, ftruncateSync, writeSync, fstatSync, readSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
export const stableId = (...parts) => createHash('sha256').update(JSON.stringify(parts)).digest('hex');
export function transaction(botsDir, fn) {
  const dir = join(botsDir, '.collaboration'); mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(join(dir, 'state.sqlite'));
  try {
    db.exec('PRAGMA busy_timeout=10000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS records (bucket TEXT, id TEXT, value TEXT NOT NULL, pending INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(bucket,id));');
    db.exec('BEGIN IMMEDIATE');
    // Pending-only indexes keep old payloads out of the supervisor/gateway's working RAM.
    if (!db.prepare('PRAGMA table_info(records)').all().some(c => c.name === 'pending')) {
      db.exec(`ALTER TABLE records ADD COLUMN pending INTEGER NOT NULL DEFAULT 0;
        UPDATE records SET pending=CASE WHEN json_extract(value,'$.delivered')=0 OR json_extract(value,'$.done')=0 OR json_extract(value,'$.claimed')=0 OR json_extract(value,'$.planned')=0 THEN 1 ELSE 0 END`);
    }
    db.exec('CREATE INDEX IF NOT EXISTS records_pending ON records(bucket,pending)');
    const store = {
      get: (bucket, id) => { const row = db.prepare('SELECT value FROM records WHERE bucket=? AND id=?').get(bucket, id); return row ? JSON.parse(row.value) : null; },
      put: (bucket, id, value) => db.prepare('INSERT INTO records(bucket,id,value,pending) VALUES(?,?,?,?) ON CONFLICT(bucket,id) DO UPDATE SET value=excluded.value,pending=excluded.pending').run(bucket, id, JSON.stringify(value), ['delivered','done','claimed','planned'].some(k => value[k] === false) ? 1 : 0),
      rows: (bucket, pendingOnly = false) => db.prepare(`SELECT id,value FROM records WHERE bucket=? ${pendingOnly ? 'AND pending=1' : ''} ORDER BY rowid`).all(bucket).map(r => ({ id: r.id, ...JSON.parse(r.value) })),
    };
    const result = fn(store);
    if (result?.then) throw new Error('Durable transactions must be synchronous');
    db.exec('COMMIT'); return result;
  } catch (e) { try { db.exec('ROLLBACK'); } catch {} throw e; }
  finally { db.close(); }
}
// Call under the Space transaction. Repair an interrupted final write before appending.
// The file itself is the receipt in the append -> SQLite commit crash window.
export function appendOnce(file, entry, deduplicate = true) {
  mkdirSync(dirname(file), { recursive: true });
  const fd = openSync(file, 'a+');
  try {
    const size = fstatSync(fd).size;
    let end = size;
    if (size) {
      const byte = Buffer.alloc(1); readSync(fd, byte, 0, 1, size - 1);
      if (byte[0] !== 10) {
        // A torn final record is not a receipt. Search backwards without loading a large history.
        end = 0;
        for (let offset = size; offset > 0;) {
          const start = Math.max(0, offset - 65536), tail = Buffer.alloc(offset - start);
          readSync(fd, tail, 0, tail.length, start); const newline = tail.lastIndexOf(10);
          if (newline >= 0) { end = start + newline + 1; break; } offset = start;
        }
        ftruncateSync(fd, end);
      }
    }
    if (deduplicate && entry.id && readFileSync(fd).subarray(0, end).toString('utf8').split('\n').some(line => {
      try { return JSON.parse(line).id === entry.id; } catch { return false; }
    })) { fsyncSync(fd); return false; }
    const data = Buffer.from(JSON.stringify(entry) + '\n');
    let at = 0; while (at < data.length) at += writeSync(fd, data, at, data.length - at);
    fsyncSync(fd);
  } finally { closeSync(fd); }
  const dirFd = openSync(dirname(file), 'r'); try { fsyncSync(dirFd); } finally { closeSync(dirFd); }
  return true;
}
export function appendDurable(botsDir, file, entry, deduplicate = false) { return transaction(botsDir, () => appendOnce(file, entry, deduplicate)); }
export function turnReceipt(botsDir, bot, id, done = false) {
  if (!id) return false;
  return transaction(botsDir, s => {
    const key = stableId(bot, id);
    if (done) s.put('turns', key, { bot, turnId: id, at: new Date().toISOString() });
    return !!s.get('turns', key);
  });
}
