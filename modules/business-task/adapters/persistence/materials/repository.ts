import { and, eq, sql } from 'drizzle-orm';
import type { Database } from '@crewstation/persistence';
import type { TaskId } from '@crewstation/contracts';
import { conflict, notFound } from '@crewstation/kernel';
import type { ExecutionMaterials, StoredExecutionMaterial } from '../../../ports/executionMaterials';
import { authorizeExecution, executionTransaction } from '../executionTransaction';
import { executionOperations } from '../executionTables';
import { executionTaskStates } from '../execution/lifecycleTables';
import { executionMaterials as materials } from './tables';

const view = (row: typeof materials.$inferSelect): StoredExecutionMaterial => ({ serviceId: row.serviceId, taskId: row.taskId as TaskId, requestKey: row.requestKey, sealed: row.sealed, view: { materialId: row.id, digest: row.digest, sizeBytes: row.sizeBytes, createdAt: row.createdAt.toISOString() } });
const scope = (serviceId: string, taskId: TaskId) => and(eq(materials.serviceId, serviceId), eq(materials.taskId, taskId));
export function drizzleExecutionMaterials(db: Database): ExecutionMaterials {
  return {
    find: async (serviceId, taskId, requestKey) => { const row = (await db.select().from(materials).where(and(scope(serviceId, taskId), eq(materials.requestKey, requestKey))))[0]; return row && view(row); },
    get: async (serviceId, taskId, id) => { const row = (await db.select().from(materials).where(and(scope(serviceId, taskId), eq(materials.id, id))))[0]; return row && view(row); },
    reserve: (candidate, authorization) => executionTransaction(db, candidate.serviceId, async (tx, now) => {
      const prior = (await tx.select().from(materials).where(and(scope(candidate.serviceId, candidate.taskId), eq(materials.requestKey, candidate.requestKey))))[0];
      if (prior) { if (prior.digest !== candidate.view.digest) throw conflict('材料幂等键参数不同', { code: 'idempotency_conflict' }); return view(prior); }
      const parent = (await tx.select().from(executionOperations).where(and(eq(executionOperations.serviceId, candidate.serviceId), sql`${executionOperations.intent}->'task'->>'id' = ${candidate.taskId}`)))[0];
      if (!parent) throw notFound('业务任务', candidate.taskId);
      await authorizeExecution(tx, candidate.serviceId, parent.intent.tasksSpec.executionControl === 'fenced', authorization, now);
      const state = (await tx.select().from(executionTaskStates).where(eq(executionTaskStates.taskId, candidate.taskId)))[0];
      if (state && ['closed', 'closing'].includes(state.state)) throw conflict('任务已关闭或正在关闭', { code: 'task_closed' });
      const row = (await tx.insert(materials).values({ id: candidate.view.materialId, serviceId: candidate.serviceId, taskId: candidate.taskId, requestKey: candidate.requestKey, digest: candidate.view.digest, sealed: candidate.sealed, sizeBytes: candidate.view.sizeBytes, createdAt: now }).returning())[0]!;
      return view(row);
    }),
  };
}
