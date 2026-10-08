import type { ProjectId } from '@crewstation/contracts';
import { jsonHash, precondition } from '@crewstation/kernel';
import type { Database } from '@crewstation/persistence';
import { sql } from 'drizzle-orm';
import { DevelopmentWorkPodSchema, developmentWorkIdentity } from '../../../domain/deletion/work';
import type { DevelopmentWorkProcesses } from '../../../ports/deletion/work';
import { developmentWorkHistory } from './workHistory';

/** Only a protected original whole Pod stop can recover a lost private finally. */
export async function observeDevelopmentWork(db: Database, processes: DevelopmentWorkProcesses) {
  await processes.sweep({ stopped: async () => undefined, podStopped: async (raw, digest) => {
    const original = DevelopmentWorkPodSchema.parse(raw);
    if (!/^[a-f0-9]{64}$/.test(digest)) throw precondition('开发原 Pod 整体停止摘要不完整');
    await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('crewstation.dev_session_pod_stop',${jsonHash({ process: original, digest })},true)`);
      await tx.execute(sql`INSERT INTO dev_session.callback_pod_stops(identity,original_process,digest)
        VALUES(${jsonHash(original)},${JSON.stringify(original)}::jsonb,${digest}) ON CONFLICT DO NOTHING`);
      const fact = (await tx.execute<{ digest: string }>(sql`SELECT digest FROM dev_session.callback_pod_stops WHERE identity=${jsonHash(original)}`))[0];
      if (!fact) throw precondition('开发原 Pod 停止事实没有保存');
      const projects = await tx.execute<{ project_id: ProjectId }>(sql`SELECT DISTINCT project_id FROM dev_session.original_callbacks
        WHERE original_process->>'podUid'=${original.podUid} AND original_process->>'nodeUid'=${original.nodeUid}
        AND original_process->>'nodeName'=${original.nodeName} AND exited_at IS NULL`);
      // A few lost exits must not materialize millions of unrelated ended births during rollout recovery.
      for (const row of projects) for (const callback of await developmentWorkHistory(tx, row.project_id, original)) {
        if (callback.exited || callback.process.podUid !== original.podUid || callback.process.nodeUid !== original.nodeUid || callback.process.nodeName !== original.nodeName) continue;
        await tx.execute(sql`SELECT set_config('crewstation.dev_session_pod_recovery',${jsonHash(original)},true)`);
        await tx.execute(sql`UPDATE dev_session.original_callbacks SET exited_at=clock_timestamp(),recovery_digest=${fact.digest},
          exit_digest=${developmentWorkIdentity(callback, fact.digest)} WHERE id=${callback.id} AND exited_at IS NULL`);
      }
    });
  }, releasable: async (uid) => (await db.execute<{ pending: boolean }>(sql`SELECT EXISTS(SELECT 1 FROM dev_session.original_callbacks
    WHERE original_process->>'podUid'=${uid} AND exited_at IS NULL) AS pending`))[0]?.pending === false });
}
