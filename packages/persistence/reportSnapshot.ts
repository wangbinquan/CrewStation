import { randomUUID } from 'node:crypto';
import { drizzle } from 'drizzle-orm/postgres-js';
import type postgres from 'postgres';
import type { DatabaseHandle } from './connection';
import type { Executor } from './databaseTypes';
import { privateReportWorkspace, type ReportWorkspace } from './reportWorkspace';
export interface OriginalReportSnapshot {
  readonly executor: Executor;
  readonly workspace: ReportWorkspace;
  readonly snapshotId: string;
  readonly asOf: string;
}
export interface ReportSnapshotSession {
  /** A single original pool reservation carries all source reads and private working rows. */
  run<T>(work: (snapshot: OriginalReportSnapshot) => Promise<T>, signal?: AbortSignal, admissionKey?: string): Promise<T>;
}
async function createWorkingTable(connection: postgres.ReservedSql) {
  await connection.unsafe('BEGIN');
  await connection.unsafe('CREATE TEMP TABLE cs_report_workspace (namespace text COLLATE "C" NOT NULL, key text COLLATE "C" NOT NULL, document text NOT NULL, PRIMARY KEY(namespace,key)) ON COMMIT PRESERVE ROWS');
  await connection.unsafe('COMMIT');
}
async function releaseWorkingTable(connection: postgres.ReservedSql, error: unknown, admissionKey?: string) {
  try {
    await connection.unsafe('ROLLBACK');
    await connection.unsafe('DROP TABLE IF EXISTS pg_temp.cs_report_workspace');
  } catch (cleanupError) {
    throw new AggregateError(error === undefined ? [cleanupError] : [error,cleanupError], 'Original report snapshot cleanup failed');
  } finally {
    try { if(admissionKey) await connection.unsafe('SELECT pg_advisory_unlock_shared(hashtextextended($1,0))',[admissionKey]); }
    finally { connection.release(); }
  }
}
/** Setup/cleanup are outside READ ONLY; report work only writes an already-existing TEMP relation. */
export function originalReportSnapshotSession(handle: Pick<DatabaseHandle,'client'>): ReportSnapshotSession {
  return {
    async run<T>(work: (snapshot: OriginalReportSnapshot) => Promise<T>, signal?: AbortSignal, admissionKey?: string): Promise<T> {
      signal?.throwIfAborted(); const connection = await handle.client.reserve();
      let active = false, failure: unknown, locked = false;
      try {
        signal?.throwIfAborted();
        if(admissionKey){await connection.unsafe('SELECT pg_advisory_lock_shared(hashtextextended($1,0))',[admissionKey]);locked=true;}
        signal?.throwIfAborted(); await createWorkingTable(connection);
        await connection.unsafe('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
        const [source] = await connection.unsafe<{ oid: string; position: string; as_of: string }[]>('SELECT (SELECT oid::text FROM pg_database WHERE datname=current_database()) AS oid, pg_current_snapshot()::text AS position, to_char(transaction_timestamp() AT TIME ZONE \'UTC\',\'YYYY-MM-DD"T"HH24:MI:SS.US"Z"\') AS as_of');
        if (!source?.oid || !source.position || !source.as_of) throw new Error('Original database snapshot identity missing');
        // postgres.js reserves the original query channel but omits the pool parser metadata needed by Drizzle.
        const client = new Proxy(connection,{ get: (target,key,receiver) => key === 'options' ? handle.client.options : Reflect.get(target,key,receiver) });
        const executor = drizzle({ client }); active = true;
        const snapshotId = JSON.stringify([source.oid,source.position,randomUUID()]);
        const result = await work({ executor, workspace: privateReportWorkspace(executor,() => active,signal), snapshotId, asOf: source.as_of });
        signal?.throwIfAborted();
        const [current] = await connection.unsafe<{ position: string }[]>('SELECT pg_current_snapshot()::text AS position');
        if (current?.position !== source.position) throw new Error('Original report snapshot changed');
        await connection.unsafe('COMMIT'); return result;
      } catch (error) { failure = error; throw error; }
      finally { active = false; await releaseWorkingTable(connection,failure,locked?admissionKey:undefined); }
    },
  };
}
