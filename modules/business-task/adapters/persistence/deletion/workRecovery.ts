import { jsonHash, precondition } from '@crewstation/kernel';
import type { ProjectId } from '@crewstation/contracts';
import type { Database } from '@crewstation/persistence';
import { sql } from 'drizzle-orm';
import { BusinessWorkPodSchema, businessWorkIdentity } from '../../../domain/deletion/work';
import type { BusinessWorkProcesses } from '../../../ports/deletion/work';
import { businessWorkHistory } from './workHistory';

/** An independent observer must prove the whole original Pod stopped; a lost DB connection or expired lease cannot recover a callback. */
export async function observeBusinessWork(db: Database, processes: BusinessWorkProcesses): Promise<void> {
  // A single container stop is insufficient; only the complete original Pod can replace its private finally.
  await processes.sweep({ stopped: async () => undefined, podStopped: async (raw, digest) => {
    const original = BusinessWorkPodSchema.parse(raw);
    if (!/^[a-f0-9]{64}$/.test(digest)) throw precondition('业务原 Pod 整体停止摘要不完整');
    await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('crewstation.business_task_pod_stop',${jsonHash({ process: original, digest })},true)`);
      await tx.execute(sql`INSERT INTO business_task.callback_pod_stops(identity,original_process,digest)
        VALUES(${jsonHash(original)},${JSON.stringify(original)}::jsonb,${digest}) ON CONFLICT DO NOTHING`);
      const fact = (await tx.execute<{ digest: string }>(sql`SELECT digest FROM business_task.callback_pod_stops WHERE identity=${jsonHash(original)}`))[0];
      if (!fact) throw precondition('业务原 Pod 停止事实没有保存');
      const projects = await tx.execute<{ project_id: ProjectId }>(sql`SELECT DISTINCT project_id FROM business_task.original_callbacks
        WHERE original_process->>'podUid'=${original.podUid} AND original_process->>'nodeUid'=${original.nodeUid}
          AND original_process->>'nodeName'=${original.nodeName} AND exited_at IS NULL`);
      for (const row of projects) for (const callback of await businessWorkHistory(tx, row.project_id)) {
        if (callback.exited || callback.process.podUid !== original.podUid || callback.process.nodeUid !== original.nodeUid || callback.process.nodeName !== original.nodeName) continue;
        await tx.execute(sql`SELECT set_config('crewstation.business_task_pod_recovery',${jsonHash(original)},true)`);
        await tx.execute(sql`UPDATE business_task.original_callbacks SET exited_at=clock_timestamp(),recovery_digest=${fact.digest},
          exit_digest=${businessWorkIdentity(callback, fact.digest)} WHERE id=${callback.id} AND exited_at IS NULL`);
      }
    });
  }, releasable: async (podUid) => (await db.execute<{ pending: boolean }>(sql`SELECT EXISTS(SELECT 1 FROM business_task.original_callbacks
    WHERE original_process->>'podUid'=${podUid} AND exited_at IS NULL) AS pending`))[0]?.pending === false });
}
