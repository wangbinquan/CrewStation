import { precondition } from '@crewstation/kernel';
import type { Database } from '@crewstation/persistence';
import { sql } from 'drizzle-orm';
import type { UnitOfWork } from '../../../ports/unitOfWork';
import { scopeOver } from '../drizzleUnitOfWork';
import type { ParentEndingCommitCheck } from '../developmentParentEndingScope';

/** STOP has a durable sealed project row already. Never create an ordinary quota/admission row after sealing. */
export function runtimeStopUnitOfWork(db: Database): UnitOfWork {
  return { read: scopeOver(db), run: (callback) => db.transaction(async (tx) => {
    const checks: ParentEndingCommitCheck[] = [], scope = scopeOver(tx, undefined, checks);
    const result = await callback({ ...scope, admissions: { ...scope.admissions, lock: async (projectId) => {
      const sealed = await tx.execute(sql`SELECT project_id FROM task_runtime.project_admissions WHERE project_id=${projectId} FOR UPDATE`);
      if (sealed.length !== 1) throw precondition('原运行停止缺少持久项目封写身份');
      await tx.execute(sql`SELECT project_id FROM task_runtime.admissions WHERE project_id=${projectId} FOR UPDATE`);
    } } });
    for (const check of checks) await check();
    return result;
  }) };
}
