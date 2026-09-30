import type { ProjectId } from '@crewstation/contracts';
import { precondition } from '@crewstation/kernel';
import type { Database } from '@crewstation/persistence';
import { withSharedDatabaseAdmission } from '@crewstation/persistence';
import { sql } from 'drizzle-orm';
import { beginApplicationWork, finishApplicationWork } from './applicationWork';

export const resourceAccessAdmissionKey = (id: string) => `resource-access.project-admission:${id}`;
/** 与外部适配器调用同寿命；普通业务 UOW 独立提交，准入池不占它的连接。 */
export function withResourceAccessAdmission<T>(db: Database, id: ProjectId, work: () => Promise<T>, changeId?: string): Promise<T> {
  return withSharedDatabaseAdmission(db, resourceAccessAdmissionKey(id), async (tx) => {
    const [row] = await tx.execute<{ operation_id: string | null }>(sql`SELECT operation_id FROM resource_access.deletion_fences WHERE project_id=${id}`);
    if (row?.operation_id) throw precondition('项目资源申请正在永久清理，不能继续审批或应用');
    if (!changeId) return work();
    const backend = Number((await tx.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`))[0]?.pid);
    const generation = await beginApplicationWork(db, changeId, id, backend);
    try { return await work(); }
    finally { await finishApplicationWork(db, changeId, generation, backend); }
  });
}
