import { and, asc, eq, inArray, ne, or, sql } from 'drizzle-orm';
import type { Database, Executor } from '@crewstation/persistence';
import type { TaskId } from '@crewstation/contracts';
import { conflict, notFound } from '@crewstation/kernel';
import type { ExecutionMaterials, StoredExecutionMaterial } from '../../../ports/executionMaterials';
import type { ExecutionAuthorization } from '../../../domain/executionControl';
import { authorizeExecution, executionTransaction } from '../executionTransaction';
import { executionOperations } from '../executionTables';
import { executionTaskStates } from '../execution/lifecycleTables';
import { businessAdmissionOpen } from '../deletion/admission';
import { executionMaterials as materials } from './tables';

const view = (row: typeof materials.$inferSelect): StoredExecutionMaterial => ({ state: row.state, pinRevision: row.pinRevision, objectCount: row.objectCount, serviceId: row.serviceId, taskId: row.taskId as TaskId, requestKey: row.requestKey, sealed: row.sealed, view: { materialId: row.id, digest: row.digest, sizeBytes: row.sizeBytes, createdAt: row.createdAt.toISOString() } });
const scope = (serviceId: string, taskId: TaskId) => and(eq(materials.serviceId, serviceId), eq(materials.taskId, taskId));
const retained = (days: number) => sql`clock_timestamp() - (${days}::int * interval '1 day')`;
/** The parent closed, or no attempt with this material is live or ended within the retention. */
const releasable = (days: number) => sql`(EXISTS (SELECT 1 FROM business_task.execution_task_states s WHERE s.task_id = ${materials.taskId} AND s.state = 'closed')
  OR (COALESCE(${materials.pinnedAt}, ${materials.createdAt}) < ${retained(days)} AND NOT EXISTS (SELECT 1 FROM business_task.execution_subtasks t
    WHERE t.service_id = ${materials.serviceId} AND t.task_id = ${materials.taskId} AND t.view->>'materialDigest' = ${materials.digest}
    AND (t.view->>'state' NOT IN ('succeeded', 'failed', 'cancelled') OR t.updated_at > ${retained(days)}))))`;
/** Parent, execution fence and the parent's lifecycle state, read under the caller's service lock. */
async function admitWrite(tx: Executor, candidate: StoredExecutionMaterial, authorization: ExecutionAuthorization, now: Date) {
  const parent = (await tx.select().from(executionOperations).where(and(eq(executionOperations.serviceId, candidate.serviceId), sql`${executionOperations.intent}->'task'->>'id' = ${candidate.taskId}`)))[0];
  if (!parent) throw notFound('业务任务', candidate.taskId);
  await authorizeExecution(tx, candidate.serviceId, parent.intent.tasksSpec.executionControl === 'fenced', authorization, now);
  return (await tx.select().from(executionTaskStates).where(eq(executionTaskStates.taskId, candidate.taskId)))[0]?.state;
}
function assertWritable(state: string | undefined): void {
  if (state === 'finalizing') throw conflict('任务正在终结，不能写入新材料', { code: 'task_finalizing' });
  if (state && ['closed', 'closing'].includes(state)) throw conflict('任务已关闭或正在关闭', { code: 'task_closed' });
}
export function drizzleExecutionMaterials(db: Database): ExecutionMaterials {
  return {
    find: async (serviceId, taskId, requestKey) => { const row = (await db.select().from(materials).where(and(scope(serviceId, taskId), eq(materials.requestKey, requestKey))))[0]; return row && view(row); },
    get: async (serviceId, taskId, id) => { const row = (await db.select().from(materials).where(and(scope(serviceId, taskId), eq(materials.id, id), ne(materials.state, 'preparing'))))[0]; return row && view(row); },
    publish: (candidate, authorization) => executionTransaction(db, candidate.serviceId, async (tx, now) => {
      const original = (await tx.select().from(materials).where(and(scope(candidate.serviceId, candidate.taskId), eq(materials.id, candidate.view.materialId))))[0];
      if (!original || original.digest !== candidate.view.digest) throw conflict('材料受理身份不匹配');
      const state = await admitWrite(tx, candidate, authorization, now);
      if (original.state === 'ready') return view(original);
      if (state && ['finalizing', 'closing', 'closed'].includes(state)) throw conflict('任务当前不能发布材料', { code: 'task_closed' });
      if (original.state !== 'preparing' || original.pinRevision !== (candidate.pinRevision ?? 1)) throw conflict('材料对象引用已释放，请用原 requestKey 重新受理材料', { code: 'material_released' });
      return view((await tx.update(materials).set({ state: 'ready' }).where(eq(materials.id, original.id)).returning())[0]!);
    }),
    reserve: (candidate, authorization) => executionTransaction(db, candidate.serviceId, async (tx, now) => {
      const prior = (await tx.select().from(materials).where(and(scope(candidate.serviceId, candidate.taskId), eq(materials.requestKey, candidate.requestKey))))[0];
      if (prior) { if (prior.digest !== candidate.view.digest) throw conflict('材料幂等键参数不同', { code: 'idempotency_conflict' }); return view(prior); }
      assertWritable(await admitWrite(tx, candidate, authorization, now));
      const row = (await tx.insert(materials).values({ state: candidate.state ?? 'ready', id: candidate.view.materialId, serviceId: candidate.serviceId, taskId: candidate.taskId, requestKey: candidate.requestKey, digest: candidate.view.digest, sealed: candidate.sealed, sizeBytes: candidate.view.sizeBytes, createdAt: now, objectCount: candidate.objectCount ?? null, pinnedAt: now }).returning())[0]!;
      return view(row);
    }),
    revive: (candidate, authorization) => executionTransaction(db, candidate.serviceId, async (tx, now) => {
      const row = (await tx.select().from(materials).where(and(scope(candidate.serviceId, candidate.taskId), eq(materials.id, candidate.view.materialId))).for('update'))[0];
      if (!row || row.digest !== candidate.view.digest) throw conflict('材料受理身份不匹配');
      if (row.state !== 'released') return view(row);
      assertWritable(await admitWrite(tx, candidate, authorization, now));
      return view((await tx.update(materials).set({ state: 'preparing', pinRevision: row.pinRevision + 1, pinnedAt: now }).where(eq(materials.id, row.id)).returning())[0]!);
    }),
    releaseCandidates: async (limit, days) => (await db.select().from(materials).where(and(businessAdmissionOpen(materials.serviceId), or(eq(materials.state, 'releasing'),
      and(inArray(materials.state, ['ready', 'preparing']), sql`(${materials.objectCount} IS NULL OR ${materials.objectCount} > 0)`, releasable(days)))))
      .orderBy(asc(materials.createdAt)).limit(limit)).map(view),
    recordObjectCount: async (material, count) => { await db.update(materials).set({ objectCount: count }).where(and(eq(materials.id, material.view.materialId), sql`${materials.objectCount} IS NULL`)); },
    beginRelease: (material, days) => executionTransaction(db, material.serviceId, async (tx) => {
      const row = (await tx.select().from(materials).where(and(eq(materials.id, material.view.materialId), eq(materials.pinRevision, material.pinRevision ?? 1))).for('update'))[0];
      if (row?.state === 'releasing') return view(row);
      if (!row || !['ready', 'preparing'].includes(row.state) || !(await tx.select({ id: materials.id }).from(materials).where(and(eq(materials.id, row.id), releasable(days)))).length) return undefined;
      return view((await tx.update(materials).set({ state: 'releasing' }).where(eq(materials.id, row.id)).returning())[0]!);
    }),
    completeRelease: (material) => executionTransaction(db, material.serviceId, async (tx) => {
      await tx.update(materials).set({ state: 'released' }).where(and(eq(materials.id, material.view.materialId), eq(materials.state, 'releasing'), eq(materials.pinRevision, material.pinRevision ?? 1)));
    }),
  };
}

/** Attempt admission shares the service lock with beginRelease: a released material can never gain a new attempt. */
export async function assertMaterialUsable(tx: Executor, materialId: string): Promise<void> {
  const row = (await tx.select({ state: materials.state }).from(materials).where(eq(materials.id, materialId)))[0];
  if (row?.state !== 'ready') throw conflict('材料对象引用已释放，请用原 requestKey 重新受理材料', { code: 'material_released' });
}
