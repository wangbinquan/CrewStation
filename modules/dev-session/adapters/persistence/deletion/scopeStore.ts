import type { ProjectDeletionContext, ProjectDeletionTarget } from '@crewstation/contracts';
import { precondition } from '@crewstation/kernel';
import type { Executor } from '@crewstation/persistence';
import { sql } from 'drizzle-orm';
import { DevelopmentDeletionProofsSchema, DevelopmentDeletionScopeSchema } from '../../../domain/deletion/projectDeletion';
import { developmentWorkIdentity } from '../../../domain/deletion/work';
import type { DevelopmentWorkCallback } from '../../../domain/deletion/work';
import type { DevelopmentWorkSources } from '../../../ports/deletion/work';
import { inspectDevelopmentContent } from './inspection';
import { developmentWorkHistory } from './workHistory';

export async function inspection(db: Executor, sources: DevelopmentWorkSources, target: ProjectDeletionTarget) {
  const current = await inspectDevelopmentContent(db, sources, target.id), callbacks = await developmentWorkHistory(db, target.id);
  return { ...current, scope: DevelopmentDeletionScopeSchema.parse({ contents: current.contents, callbacks,
    digest: current.traversal.digest, count: current.contents.length, compacted: false }) };
}
export async function load(db: Executor, context: ProjectDeletionContext) {
  const row = (await db.execute<{ operation_id: string; generation: number; revision: string; body: unknown; phases: unknown; verified: boolean }>(sql`
    SELECT operation_id,generation,revision,body,phases,verified FROM dev_session.project_deletions WHERE project_id=${context.target.id} FOR UPDATE`))[0];
  if (!row || row.operation_id !== context.operationId || row.generation > context.generation || row.revision !== context.confirmed.revision || !row.verified)
    throw precondition('开发清理原操作、世代或完整确认范围不符');
  return { scope: DevelopmentDeletionScopeSchema.parse(row.body), proofs: DevelopmentDeletionProofsSchema.parse(row.phases) };
}
export async function exited(db: Executor, original: DevelopmentWorkCallback) {
  const rows = await db.execute(sql`SELECT id FROM dev_session.original_callbacks r WHERE id=${original.id}
    AND dev_session.work_identity(to_jsonb(r))=${developmentWorkIdentity(original)} AND exited_at IS NOT NULL
    AND exit_digest=dev_session.work_identity(to_jsonb(r),recovery_digest)`);
  return rows.length === 1;
}
export async function legacyPending(db: Executor, context: ProjectDeletionContext) {
  return (await db.execute(sql`SELECT r.agent_id FROM dev_session.agent_starts r INNER JOIN dev_session.content_origins o ON o.kind='task' AND o.key=r.task_id
    WHERE o.project_id=${context.target.id} AND NOT r.finalized
    UNION ALL SELECT r.agent_id FROM dev_session.native_terminal_starts r INNER JOIN dev_session.content_origins o ON o.kind='task' AND o.key=r.task_id
    WHERE o.project_id=${context.target.id} AND CASE WHEN r.execution IS NULL THEN COALESCE(r.record->>'lifecycle','unknown') NOT IN('ended','failed')
      ELSE COALESCE(r.execution->>'finalized','false')<>'true' END LIMIT 1`)).length !== 0;
}
export async function renewAdmission(tx: Executor, context: ProjectDeletionContext) {
  const row = (await tx.execute<{ operation_id: string; generation: number; revision: string }>(sql`SELECT operation_id,generation,revision FROM dev_session.project_admissions WHERE project_id=${context.target.id} FOR UPDATE`))[0];
  if (!row || row.operation_id !== context.operationId || row.generation > context.generation || row.revision !== context.confirmed.revision)
    throw precondition('开发原封写操作、世代或确认范围不符');
  if (row.generation < context.generation) {
    await tx.execute(sql`SELECT set_config('crewstation.dev_session_deletion_owner',${context.operationId + ':' + context.generation + ':seal'},true)`);
    await tx.execute(sql`UPDATE dev_session.project_admissions SET generation=${context.generation} WHERE project_id=${context.target.id}`);
  }
}
export const pending = async (db: Executor, context: ProjectDeletionContext) => (await db.execute(sql`SELECT id FROM dev_session.original_callbacks WHERE project_id=${context.target.id} AND exited_at IS NULL LIMIT 1`)).length !== 0;
