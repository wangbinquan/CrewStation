import { Database } from 'bun:sqlite';
import { randomUUID } from 'node:crypto';
import { NativeUsageOrderSchema } from '@crewstation/contracts';
import { readNativeUsageSnapshot, type NativeUsageSnapshot, type NativeScanOptions } from './nativeSnapshot';

/** The observer owns this sidecar; the upstream native database stays read-only. */
export function readOrderedNativeUsageSnapshot(path: string | null, root: string, options: NativeScanOptions = {}): NativeUsageSnapshot {
  let db: Database | undefined, snapshot: NativeUsageSnapshot | undefined;
  try {
    if (!path) throw new Error('Native snapshot order unavailable');
    db = new Database(path + '.crewstation-usage.sqlite');
    db.exec('PRAGMA busy_timeout = 0');
    // Acquire the order lock BEFORE opening the native read snapshot. Reversing
    // these operations can give an older snapshot a newer sequence.
    db.exec('BEGIN IMMEDIATE');
    const ordered = readNativeSnapshotWithinOrder(db, path, root, options);
    const { order: _order, ...value } = ordered; snapshot = value;
    db.exec('COMMIT');
    return ordered;
  } catch {
    try { db?.exec('ROLLBACK'); } catch { /* A failed BEGIN has no transaction. */ }
    const value = snapshot ?? readNativeUsageSnapshot(path, root, options);
    return { ...value, issues: [...new Set([...value.issues, 'native-order-unavailable'])] };
  } finally { try { db?.close(); } catch { /* Observation cannot change business results. */ } }
}

/** Caller already holds the observer-sidecar immediate transaction; native data remains read-only. */
export function readNativeSnapshotWithinOrder(db: Database, path: string, root: string, options: NativeScanOptions = {}): NativeUsageSnapshot {
  db.exec('CREATE TABLE IF NOT EXISTS snapshot_order (id INTEGER PRIMARY KEY CHECK(id=1), epoch TEXT NOT NULL, sequence INTEGER NOT NULL)');
  db.query('INSERT OR IGNORE INTO snapshot_order VALUES (1,?,0)').run(randomUUID());
  const before = db.query<{ epoch: string; sequence: number }, []>('SELECT epoch,sequence FROM snapshot_order WHERE id=1').get();
  if (!before || !Number.isSafeInteger(before.sequence) || before.sequence < 0) throw new Error('Invalid native snapshot order');
  const order = NativeUsageOrderSchema.parse({ epoch: before.epoch, sequence: before.sequence + 1 });
  const snapshot = readNativeUsageSnapshot(path, root, options);
  db.query('UPDATE snapshot_order SET sequence=? WHERE id=1').run(order.sequence);
  return { ...snapshot, order };
}
