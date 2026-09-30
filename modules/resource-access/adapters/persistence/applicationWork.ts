import type { ProjectId } from '@crewstation/contracts';
import { conflict, precondition } from '@crewstation/kernel';
import type { Database, Executor } from '@crewstation/persistence';
import { sql } from 'drizzle-orm';

/** 最小在途事实与普通 UOW 独立持久化；锁断线不能把仍在外部调用的进程误认为已退出。 */
export async function beginApplicationWork(db: Database, changeId: string, projectId: ProjectId, backend: number): Promise<number> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`INSERT INTO resource_access.deletion_work(change_id,project_id) VALUES (${changeId},${projectId}) ON CONFLICT DO NOTHING`);
    const [row] = await tx.execute<{ project_id: string; state: string; generation: number }>(sql`SELECT project_id,state,generation FROM resource_access.deletion_work WHERE change_id=${changeId} FOR UPDATE`);
    if (row?.project_id !== projectId) throw precondition('资源申请在途身份不属于原项目');
    if (row.state === 'running') throw conflict('原资源申请仍有在途应用，等待其退出后继续');
    const [change] = await tx.execute(sql`SELECT id FROM resource_access.changes WHERE id=${changeId} AND project_id=${projectId} AND state IN ('approved','applying')`);
    const [fence] = await tx.execute<{ operation_id: string | null }>(sql`SELECT operation_id FROM resource_access.deletion_fences WHERE project_id=${projectId}`);
    if (!change || fence?.operation_id) throw precondition('资源申请已关闭，不能开始应用');
    const generation = row.generation + 1;
    await tx.execute(sql`UPDATE resource_access.deletion_work SET state='running',generation=${generation},backend_pid=${backend} WHERE change_id=${changeId}`);
    return generation;
  });
}
export async function finishApplicationWork(db: Database, changeId: string, generation: number, backend: number) {
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('crewstation.resource_access_work_exit',${`${changeId}:${generation}:${backend}`},true)`);
    await tx.execute(sql`UPDATE resource_access.deletion_work SET state='finished' WHERE change_id=${changeId} AND generation=${generation} AND backend_pid=${backend}`);
  });
}
export async function applicationWorkPending(db: Executor, projectId: ProjectId) {
  const [row] = await db.execute<{ pending: boolean }>(sql`SELECT EXISTS(SELECT 1 FROM resource_access.deletion_work WHERE project_id=${projectId} AND state='running') AS pending`);
  return row?.pending !== false;
}
