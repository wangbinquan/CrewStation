import type { ProjectDeletionContext, ProjectDeletionTarget } from '@crewstation/contracts';
import { jsonHash, precondition } from '@crewstation/kernel';
import type { Executor } from '@crewstation/persistence';
import { sql } from 'drizzle-orm';
import { RuntimeDeletionProofsSchema, RuntimeDeletionScopeSchema } from '../../../domain/deletion/projectDeletion';
import { runtimeWorkIdentity } from '../../../domain/deletion/work';
import type { RuntimeWorkCallback } from '../../../domain/deletion/work';
import type { RuntimeDeletionSources } from '../../../ports/deletion/sources';
import { inspectRuntimeContent } from './inspection';
import { runtimeWorkHistory } from './workHistory';
import { registerRuntimeWorkOrigin, retainedRuntimeOrigin } from './workOrigin';

/** Only a completed original metadata scope can supply roots already removed by later owners. */
export function retainedRuntimeSources(db: Executor, sources: RuntimeDeletionSources): RuntimeDeletionSources {
  return { resolve: async (kind, key, representation) => {
    const current = await sources.resolve(kind, key, representation);
    if (current || kind === 'business-task') return current;
    const saved = await retainedRuntimeOrigin(db, kind, key);
    if (!saved) return undefined;
    const complete = await db.execute(sql`SELECT project_id FROM task_runtime.project_deletions
      WHERE project_id=${saved.projectIds[0]} AND verified AND body->>'compacted'='true'`);
    return complete.length === 1 ? saved : undefined;
  } };
}
export async function inspectRuntimeScope(db: Executor, sources: RuntimeDeletionSources, target: ProjectDeletionTarget) {
  const current = await inspectRuntimeContent(db, retainedRuntimeSources(db, sources), target.id), callbacks = await runtimeWorkHistory(db, target.id);
  return { ...current, scope: RuntimeDeletionScopeSchema.parse({ contents: current.contents, callbacks, digest: current.traversal.digest,
    count: current.contents.length, compacted: false, stopped: null }) };
}
export async function loadRuntimeScope(db: Executor, context: ProjectDeletionContext) {
  const row = (await db.execute<{ operation_id: string; generation: number; revision: string; body: unknown; phases: unknown; verified: boolean }>(sql`
    SELECT operation_id,generation,revision,body,phases,verified FROM task_runtime.project_deletions WHERE project_id=${context.target.id} FOR UPDATE`))[0];
  if (!row || row.operation_id !== context.operationId || row.generation > context.generation || row.revision !== context.confirmed.revision || !row.verified)
    throw precondition('运行清理原操作、世代或完整确认范围不符');
  return { scope: RuntimeDeletionScopeSchema.parse(row.body), proofs: RuntimeDeletionProofsSchema.parse(row.phases) };
}
export async function runtimeCallbackExited(db: Executor, original: RuntimeWorkCallback) {
  return (await db.execute(sql`SELECT id FROM task_runtime.original_callbacks r WHERE id=${original.id}
    AND task_runtime.work_identity(to_jsonb(r))=${runtimeWorkIdentity(original)} AND exited_at IS NOT NULL
    AND exit_digest=task_runtime.work_identity(to_jsonb(r),recovery_digest)`)).length === 1;
}
/** Inventory roots use the same minimum public identity as ordinary callback birth, including original legacy keys. */
export async function registerRuntimeScopeOrigins(db: Executor, context: ProjectDeletionContext, inspected: Awaited<ReturnType<typeof inspectRuntimeScope>>) {
  for (const origin of inspected.origins) await registerRuntimeWorkOrigin(db, { projectId: origin.projectId, originKind: origin.kind, originKey: origin.key,
    kind: 'deletion', reference: context.operationId, inputDigest: origin.identity }, { complete: true, id: origin.id, scope: 'project', projectIds: [origin.projectId],
    revision: jsonHash({ kind: origin.kind, id: origin.id, projectId: origin.projectId }) });
}
export async function renewRuntimeAdmission(db: Executor, context: ProjectDeletionContext, create = false) {
  await db.execute(sql`SELECT set_config('crewstation.task_runtime_deletion_owner',${context.operationId + ':' + context.generation + ':seal'},true)`);
  if (create) await db.execute(sql`INSERT INTO task_runtime.project_admissions(project_id,operation_id,generation,revision)
    VALUES(${context.target.id},${context.operationId},${context.generation},${context.confirmed.revision}) ON CONFLICT DO NOTHING`);
  const row = (await db.execute<{ operation_id: string; generation: number; revision: string }>(sql`
    SELECT operation_id,generation,revision FROM task_runtime.project_admissions WHERE project_id=${context.target.id} FOR UPDATE`))[0];
  if (!row || row.operation_id !== context.operationId || row.generation > context.generation)
    throw precondition('运行原封写操作或世代已变化');
  if (row.generation < context.generation) await db.execute(sql`UPDATE task_runtime.project_admissions SET generation=${context.generation},
    revision=${create ? context.confirmed.revision : row.revision} WHERE project_id=${context.target.id}`);
  else if (create && row.revision !== context.confirmed.revision) throw precondition('运行同一世代不能替换确认范围');
}
