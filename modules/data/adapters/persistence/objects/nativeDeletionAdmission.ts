import { AsyncLocalStorage } from 'node:async_hooks';
import type { ProjectDeletionContext } from '@crewstation/contracts';
import { jsonHash, precondition } from '@crewstation/kernel';
import { withExclusiveDatabaseAdmission } from '@crewstation/persistence';
import type { Database, Transaction } from '@crewstation/persistence';
import { sql } from 'drizzle-orm';
import { DATA_NATIVE_BLOCK_ADMISSION, DataDeletionScopeSchema } from '../../../domain/deletionContents';
import type { DataDeletionScope } from '../../../ports/deletion/projectDeletion';

/** Fresh owner grants plus the real shared backend admission close the gap
 * between a native foreign-reference scan and Garage's purge operation. */
export function nativeObjectDeletionAdmission(db: Database, grant: (context: ProjectDeletionContext) => Promise<void>) {
  const scopes = new AsyncLocalStorage<{ active: boolean; tx: Transaction; backend: number }>();
  const authorize = async (context: ProjectDeletionContext) => {
    await grant(context);
    const current = scopes.getStore();
    if (current) {
      if (!current.active) throw precondition('Garage 原排他准入已经退出');
      const row = (await current.tx.execute<{ locked: boolean }>(sql`SELECT EXISTS(SELECT 1 FROM pg_locks WHERE locktype='advisory' AND pid=${current.backend} AND granted AND mode='ExclusiveLock'
        AND database=(SELECT oid FROM pg_database WHERE datname=current_database()) AND classid=((hashtextextended(${DATA_NATIVE_BLOCK_ADMISSION},0)>>32)&4294967295)::oid
        AND objid=(hashtextextended(${DATA_NATIVE_BLOCK_ADMISSION},0)&4294967295)::oid AND objsubid=1) AS locked`))[0];
      if (!row?.locked) throw precondition('Garage 原排他准入锁已经丢失');
    }
  };
  return { authorize,
    closed: async (context: ProjectDeletionContext, scope: DataDeletionScope) => {
      await authorize(context);
      return db.transaction(async tx => {
        const row = (await tx.execute<{ operation_id: string; generation: number; revision: string; verified: boolean; body: unknown }>(sql`SELECT operation_id,generation,revision,verified,body FROM data.project_deletions WHERE project_id=${context.target.id}`))[0];
        if (!row?.verified || row.operation_id !== context.operationId || row.generation > context.generation || row.revision !== context.confirmed.revision) throw precondition('Garage 原对象封写许可不符');
        const original = DataDeletionScopeSchema.parse(row.body);
        if (original.digest !== scope.digest || original.nativeHistory?.digest !== scope.nativeHistory?.digest) throw precondition('Garage 原对象范围不符');
        const current = (await tx.execute<{ pending: boolean }>(sql`SELECT
          EXISTS(SELECT 1 FROM data.object_work WHERE project_id=${context.target.id} AND state<>'finished')
          OR EXISTS(SELECT 1 FROM data.object_read_transfers r INNER JOIN data.object_spaces s ON s.id=r.space_id WHERE s.project_id=${context.target.id} AND r.body->>'endedAt' IS NULL)
          OR EXISTS(SELECT 1 FROM data.object_upload_attempts a INNER JOIN data.object_spaces s ON s.id=a.space_id WHERE s.project_id=${context.target.id} AND (a.state='verifying' OR a.state IN('streaming','unknown') AND a.body->>'writerEndedAt' IS NULL)) AS pending`))[0];
        return current?.pending === false ? jsonHash({ project: context.target.id, operation: row.operation_id, source: original.nativeHistory?.digest, closed: true }) : undefined;
      }, { isolationLevel: 'repeatable read', accessMode: 'read only' });
    },
    exclusive: async <T>(context: ProjectDeletionContext, work: () => Promise<T>): Promise<T | undefined> => {
      if (context.phase !== 'purge') throw precondition('Garage 块排他清理只接受 purge 阶段');
      let original: { active: boolean; tx: Transaction; backend: number } | undefined;
      try { return await withExclusiveDatabaseAdmission(db, DATA_NATIVE_BLOCK_ADMISSION, async tx => {
        if ((await db.execute<{ pending: boolean }>(sql`SELECT EXISTS(SELECT 1 FROM data.object_work WHERE state='running') AS pending`))[0]?.pending !== false) return undefined;
        original = { active: true, tx, backend: (await tx.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`))[0]!.pid };
        return scopes.run(original, async () => { try { await authorize(context); const result = await work(); await authorize(context); return result; } finally { original!.active = false; } });
      }); } catch (error) {
        if (original) original.active = false;
        if (lockBusy(error)) return undefined; throw error;
      }
    },
  };
}
function lockBusy(error: unknown): boolean {
  return !!error && typeof error === 'object' && ('code' in error && error.code === '55P03' || 'cause' in error && lockBusy(error.cause));
}
