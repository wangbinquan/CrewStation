import type { ProjectId } from '@crewstation/contracts';
import { precondition } from '@crewstation/kernel';
import type { Database, Executor } from '@crewstation/persistence';
import { withSharedDatabaseAdmissions } from '@crewstation/persistence';
import { sql } from 'drizzle-orm';
import type { DeliveryProcessOwners } from '../../ports/deliveryProcesses';
import { beginDeliveryWork, finishDeliveryWork } from './deliveryWork';

export const eventsAdmissionKey = (id: string) => `events.project-admission:${id}`;
async function projectsOfDelivery(db: Executor, deliveryId: string): Promise<ProjectId[]> {
  const rows = await db.execute<{ project_id: ProjectId }>(sql`SELECT project_id FROM events.deletion_links WHERE kind='delivery' AND entity_key=${deliveryId} ORDER BY project_id`);
  if (!rows.length) throw precondition('原事件投递缺少持久项目归属');
  return rows.map((r) => r.project_id);
}
export function eventsAdmissions(db: Database, available?: (id: ProjectId) => Promise<void>, processes?: DeliveryProcessOwners) {
  const admit = <T>(ids: readonly ProjectId[], work: (guard: Executor) => Promise<T>): Promise<T> => withSharedDatabaseAdmissions(db,ids.map(eventsAdmissionKey),async (guard) => {
    for (const id of [...new Set(ids)].sort()) {
      const [row] = await guard.execute<{ operation_id: string | null }>(sql`SELECT operation_id FROM events.deletion_fences WHERE project_id=${id}`);
      if (row?.operation_id) throw precondition('项目事件正在永久清理，不能登记、生产、重放或投递');
      await available?.(id);
    }
    return work(guard);
  });
  return {
    withAdmission: <T>(ids: readonly ProjectId[], work: () => Promise<T>) => admit(ids,work),
    withDeliveryAdmission: async <T>(id: string, work: () => Promise<T>, pushing = true): Promise<T> => admit(await projectsOfDelivery(db,id),async (guard) => {
      if (!pushing) return work();
      const process = await processes?.protectCurrent();
      const backend = Number((await guard.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`))[0]?.pid);
      const generation = await beginDeliveryWork(db,id,backend,process);
      try { return await work(); }
      finally { await finishDeliveryWork(db,id,generation,backend); }
    }),
  };
}
