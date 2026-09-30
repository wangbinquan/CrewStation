import type { ProjectDeletionContext } from '@crewstation/contracts';
import { precondition } from '@crewstation/kernel';
import type { Database } from '@crewstation/persistence';
import { sql } from 'drizzle-orm';
import { resourceAccessAdmissionKey } from './projectAdmission';

const protectedBackend = (key: string) => sql`EXISTS(SELECT 1 FROM pg_catalog.pg_locks WHERE locktype='advisory' AND granted AND mode='ShareLock' AND pid=w.backend_pid
  AND database=(SELECT oid FROM pg_catalog.pg_database WHERE datname=current_database()) AND objsubid=1
  AND classid::bigint=((hashtextextended(${key},0) >> 32) & 4294967295) AND objid::bigint=(hashtextextended(${key},0) & 4294967295))`;

export function resourceAccessDeletionRecovery(db: Database, assertGrant: (context: ProjectDeletionContext) => Promise<void>) {
  return {
    unprotectedWork: async (context: ProjectDeletionContext) => {
      await assertGrant(context);
      const rows = await db.execute<{ change_id: string; generation: number }>(sql`SELECT change_id,generation FROM resource_access.deletion_work w WHERE project_id=${context.target.id} AND state='running' AND NOT ${protectedBackend(resourceAccessAdmissionKey(context.target.id))} ORDER BY change_id`);
      return rows.map((r) => ({ changeId: r.change_id, generation: r.generation }));
    },
    recoverWork: (context: ProjectDeletionContext, changeId: string, generation: number, digest: string) => db.transaction(async (tx) => {
      const [row] = await tx.execute<{ state: string; generation: number; backend_pid: number; protected: boolean }>(sql`SELECT state,generation,backend_pid,${protectedBackend(resourceAccessAdmissionKey(context.target.id))} AS protected FROM resource_access.deletion_work w WHERE change_id=${changeId} AND project_id=${context.target.id} FOR UPDATE`);
      await assertGrant(context);
      if (!row || row.generation !== generation || row.state !== 'running' || row.protected) return;
      if (!/^[a-f0-9]{64}$/.test(digest)) throw precondition('资源申请恢复证明不完整');
      await tx.execute(sql`SELECT set_config('crewstation.resource_access_work_exit',${`${changeId}:${generation}:${row.backend_pid}`},true)`);
      await tx.execute(sql`UPDATE resource_access.deletion_work SET state='finished',recovery_digest=${digest} WHERE change_id=${changeId} AND generation=${generation}`);
    }),
  };
}
