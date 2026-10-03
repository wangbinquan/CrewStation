import { PROJECT_DELETION_PHASES, ProjectDeletionEvidenceSchema } from '@crewstation/contracts';
import type { ProjectDeletionContext, ProjectDeletionTarget } from '@crewstation/contracts';
import { jsonHash, precondition } from '@crewstation/kernel';
import type { Database, Executor } from '@crewstation/persistence';
import { withExclusiveDatabaseAdmission } from '@crewstation/persistence';
import { sql } from 'drizzle-orm';
import { BusinessDeletionProofsSchema, BusinessDeletionScopeSchema } from '../../../domain/deletion/projectDeletion';
import { BusinessWorkOriginSchema, businessWorkIdentity } from '../../../domain/deletion/work';
import type { BusinessWorkCallback } from '../../../domain/deletion/work';
import type { BusinessDeletionRepository } from '../../../ports/deletion/projectDeletion';
import type { BusinessWorkSources } from '../../../ports/deletion/work';
import { inspectBusinessContent, registeredBusinessContent } from './inspection';
import { registerBusinessOrigin } from './origins';
import { purgeBusinessContent } from './purge';
import { businessWorkHistory } from './workHistory';
import { observeBusinessWork } from './workRecovery';

async function inspection(db: Executor, sources: BusinessWorkSources, target: ProjectDeletionTarget) {
  if (!target.serviceId) throw precondition('业务清理缺少原服务标识');
  let source = await sources.resolve('service', target.serviceId, 'current');
  if (!source) {
    // Project removes its service content after business metadata. Only this completed original scope may supply its minimum link.
    const rows = await db.execute<{ id: string; project_id: string; identity: string }>(sql`SELECT o.id,o.project_id,o.identity FROM business_task.content_origins o
      INNER JOIN business_task.project_deletions d ON d.project_id=o.project_id WHERE o.kind='service' AND o.key=${target.serviceId}
      AND o.id=${target.serviceId} AND o.project_id=${target.id} AND d.verified AND d.body->>'compacted'='true'`);
    const original = rows[0];
    if (rows.length === 1 && original!.identity === jsonHash({ kind: 'service', key: target.serviceId, id: target.serviceId, projectId: target.id }))
      source = { complete: true, id: original!.id, scope: 'project', projectIds: [target.id], revision: original!.identity };
  }
  const origin = BusinessWorkOriginSchema.parse(source);
  if (origin.id !== target.serviceId || origin.projectIds[0] !== target.id) throw precondition('业务清理的原服务项目不符');
  const current = await inspectBusinessContent(db, sources, target.id), callbacks = await businessWorkHistory(db, target.id);
  const service = { kind: 'service' as const, key: target.serviceId, id: target.serviceId, projectId: target.id };
  return { ...current, origins: [...current.origins, { ...service, identity: jsonHash(service) }],
    scope: BusinessDeletionScopeSchema.parse({ contents: current.contents, callbacks, digest: current.traversal.digest, count: current.contents.length, compacted: false }) };
}
async function load(db: Executor, context: ProjectDeletionContext) {
  const row = (await db.execute<{ operation_id: string; generation: number; revision: string; body: unknown; phases: unknown; verified: boolean }>(sql`
    SELECT operation_id,generation,revision,body,phases,verified FROM business_task.project_deletions WHERE project_id=${context.target.id} FOR UPDATE`))[0];
  if (!row || row.operation_id !== context.operationId || row.generation > context.generation || row.revision !== context.confirmed.revision || !row.verified)
    throw precondition('业务清理原操作、世代或完整确认范围不符');
  return { scope: BusinessDeletionScopeSchema.parse(row.body), proofs: BusinessDeletionProofsSchema.parse(row.phases) };
}
async function exited(db: Executor, original: BusinessWorkCallback) {
  const rows = await db.execute(sql`SELECT id FROM business_task.original_callbacks r WHERE id=${original.id}
    AND business_task.work_identity(to_jsonb(r))=${businessWorkIdentity(original)} AND exited_at IS NOT NULL
    AND exit_digest=business_task.work_identity(to_jsonb(r),recovery_digest)`);
  return rows.length === 1;
}
async function legacyPending(db: Executor, context: ProjectDeletionContext) {
  return (await db.execute(sql`SELECT r.id FROM business_task.legacy_mutations r INNER JOIN business_task.content_origins o ON o.kind='service' AND o.key=r.service_id
    WHERE o.project_id=${context.target.id} AND r.state<>'complete' AND NOT EXISTS(SELECT 1 FROM business_task.original_callbacks c
      WHERE c.id=r.callback_id AND c.service_id=r.service_id AND c.kind='legacy-api' AND c.exited_at IS NOT NULL
      AND c.exit_digest=business_task.work_identity(to_jsonb(c),c.recovery_digest)) LIMIT 1`)).length !== 0;
}
export function businessDeletionRepository(db: Database, sources: BusinessWorkSources): BusinessDeletionRepository {
  const transact = <T>(context: ProjectDeletionContext, action: (tx: Executor) => Promise<T>) => withExclusiveDatabaseAdmission(db, 'business-task.project-admission:' + context.target.id, async (tx) => {
    await sources.assertGrant(context); await registeredBusinessContent(tx);
    await tx.execute(sql`SELECT set_config('crewstation.business_task_deletion',${context.operationId + ':' + context.generation + ':' + context.phase},true)`);
    if (context.phase === 'seal' || context.phase === 'metadata') await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended('business-task.content-origins',0))`);
    const result = await action(tx); await sources.assertGrant(context); return result;
  });
  return {
    inspect: (target) => db.transaction(async (tx) => { await tx.execute(sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`); return inspection(tx, sources, target); }),
    seal: (context) => transact(context, async (tx) => {
      if (context.phase !== 'seal') throw precondition('业务清理范围只能在封写阶段受理');
      const old = (await tx.execute<{ operation_id: string; generation: number; revision: string; verified: boolean }>(sql`SELECT operation_id,generation,revision,verified FROM business_task.project_deletions WHERE project_id=${context.target.id} FOR UPDATE`))[0];
      if (old && (old.operation_id !== context.operationId || old.generation > context.generation || old.revision !== context.confirmed.revision && old.generation >= context.generation)) throw precondition('业务原删除操作或世代被替换');
      if (old?.verified && old.revision === context.confirmed.revision) return true;
      const current = await inspection(tx, sources, context.target), verified = current.inventory.revision === context.confirmed.revision;
      for (const origin of current.origins) await registerBusinessOrigin(tx, origin);
      await tx.execute(sql`SELECT set_config('crewstation.business_task_deletion_owner',${context.operationId + ':' + context.generation + ':seal'},true)`);
      await tx.execute(sql`INSERT INTO business_task.project_admissions(project_id,operation_id,generation,revision)
        VALUES(${context.target.id},${context.operationId},${context.generation},${context.confirmed.revision}) ON CONFLICT DO NOTHING`);
      const admission = (await tx.execute<{ operation_id: string; generation: number; revision: string }>(sql`SELECT operation_id,generation,revision FROM business_task.project_admissions WHERE project_id=${context.target.id} FOR UPDATE`))[0]!;
      if (admission.operation_id !== context.operationId || admission.generation > context.generation || admission.generation === context.generation && admission.revision !== context.confirmed.revision) throw precondition('业务原封写操作或世代不符');
      if (admission.generation < context.generation) await tx.execute(sql`UPDATE business_task.project_admissions SET generation=${context.generation},revision=${context.confirmed.revision} WHERE project_id=${context.target.id}`);
      await tx.execute(sql`INSERT INTO business_task.project_deletions(project_id,operation_id,generation,revision,body,verified)
        VALUES(${context.target.id},${context.operationId},${context.generation},${context.confirmed.revision},${JSON.stringify(current.scope)}::jsonb,${verified})
        ON CONFLICT(project_id) DO UPDATE SET generation=excluded.generation,revision=excluded.revision,body=excluded.body,verified=excluded.verified,phases='{}'::jsonb`);
      return verified;
    }),
    scope: (context) => transact(context, async (tx) => (await load(tx, context)).scope),
    proof: (context) => transact(context, async (tx) => {
      const state = await load(tx, context), index = PROJECT_DELETION_PHASES.indexOf(context.phase);
      if (index > 0 && !state.proofs[PROJECT_DELETION_PHASES[index - 1]!]) throw precondition('业务前一阶段的持久证明缺失');
      return state.proofs[context.phase];
    }),
    record: (context, raw) => transact(context, async (tx) => {
      const state = await load(tx, context), evidence = ProjectDeletionEvidenceSchema.parse(raw), index = PROJECT_DELETION_PHASES.indexOf(context.phase);
      if (index > 0 && !state.proofs[PROJECT_DELETION_PHASES[index - 1]!]) throw precondition('业务清理阶段不可跳过');
      if (state.proofs[context.phase] && jsonHash(state.proofs[context.phase]) !== jsonHash(evidence)) throw precondition('业务原阶段证明不能替换');
      await tx.execute(sql`UPDATE business_task.project_deletions SET generation=${context.generation},phases=phases||${JSON.stringify({ [context.phase]: evidence })}::jsonb WHERE project_id=${context.target.id}`);
    }),
    exited: (birth) => exited(db, birth), observe: () => observeBusinessWork(db, sources.processes),
    legacyPending: (context) => legacyPending(db, context),
    purge: (context) => transact(context, async (tx) => {
      const state = await load(tx, context);
      if (context.phase !== 'metadata' || !state.proofs.namespace) throw precondition('业务删除内容缺少前五阶段证明');
      if (!state.scope.compacted) for (const callback of state.scope.callbacks) if (!(await exited(tx, callback))) throw precondition('业务原回调仍未退出');
      if (!state.scope.compacted && await legacyPending(tx, context)) throw precondition('旧协议在途票据缺少原回调退出证明，不能删除');
      await tx.execute(sql`UPDATE business_task.project_deletions SET generation=${context.generation} WHERE project_id=${context.target.id}`);
      await purgeBusinessContent(tx, sources, context, state.scope);
      await tx.execute(sql`UPDATE business_task.project_deletions SET body=${JSON.stringify({ ...state.scope, contents: [], callbacks: [], compacted: true })}::jsonb WHERE project_id=${context.target.id}`);
    }),
  };
}
