import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { Database, Transaction } from './databaseTypes';

type OriginalLock = {
  pid: number; database: number; backendStarted: string; transactionStarted: string;
  virtualTransaction: string; classId: string; objectId: string;
};
export interface DatabaseAdmissionAuthority {
  readonly identity: string;
  /** Re-read the original backend birth, transaction and granted lock. A
   * replacement connection cannot authorize the original external callback. */
  assertActive(): Promise<string>;
}
const originalLock = (key: string, pid?: number) => sql`SELECT l.pid,l.database::integer AS database,
  a.backend_start::text AS "backendStarted",a.xact_start::text AS "transactionStarted",
  l.virtualtransaction AS "virtualTransaction",l.classid::text AS "classId",l.objid::text AS "objectId"
  FROM pg_catalog.pg_locks l JOIN pg_catalog.pg_stat_activity a ON a.pid=l.pid
  WHERE l.pid=${pid ?? sql`pg_backend_pid()`} AND l.database=(SELECT oid FROM pg_catalog.pg_database WHERE datname=current_database())
    AND l.locktype='advisory' AND l.mode='ExclusiveLock' AND l.granted AND l.objsubid=1
    AND l.classid=((hashtextextended(${key},0)>>32)&4294967295)::oid
    AND l.objid=(hashtextextended(${key},0)&4294967295)::oid`;
const identity = (row: OriginalLock) => createHash('sha256').update(JSON.stringify(row)).digest('hex');

export async function captureExclusiveAuthority(database: Database, transaction: Transaction, key: string, active: () => boolean): Promise<DatabaseAdmissionAuthority> {
  const originals = await transaction.execute<OriginalLock>(originalLock(key));
  if (originals.length !== 1 || !originals[0]!.backendStarted || !originals[0]!.transactionStarted || !originals[0]!.virtualTransaction) throw Error('Original exclusive admission is unavailable');
  const original = originals[0]!, digest = identity(original);
  return Object.freeze({ identity: digest, assertActive: async () => {
    if (!active()) throw Error('Original exclusive admission has exited');
    // Use an independent ordinary connection. The callback may still execute
    // after its driver transaction was rejected and must not touch that socket.
    const current = await database.execute<OriginalLock>(originalLock(key, original.pid));
    if (!active() || current.length !== 1 || identity(current[0]!) !== digest) throw Error('Original exclusive admission has exited or changed');
    return digest;
  } });
}
