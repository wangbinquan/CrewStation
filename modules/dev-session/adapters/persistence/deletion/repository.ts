import { PROJECT_DELETION_PHASES, ProjectDeletionEvidenceSchema } from '@crewstation/contracts';
import type { ProjectDeletionContext } from '@crewstation/contracts';
import { jsonHash, precondition } from '@crewstation/kernel';
import type { Database, Executor } from '@crewstation/persistence';
import { withExclusiveDatabaseAdmission } from '@crewstation/persistence';
import { sql } from 'drizzle-orm';
import type { DevelopmentDeletionRepository } from '../../../ports/deletion/projectDeletion';
import type { DevelopmentWorkSources } from '../../../ports/deletion/work';
import { registeredDevelopmentContent } from './inspection';
import { inspection, load, exited, legacyPending, renewAdmission, pending } from './scopeStore';
import { captureDevelopmentStopped } from './stopSnapshot';
import { registerDevelopmentOrigin } from './origins';
import { purgeDevelopmentContent } from './purge';
import { observeDevelopmentWork } from './workRecovery';

export function developmentDeletionRepository(db: Database, sources: DevelopmentWorkSources): DevelopmentDeletionRepository {
  const transact = <T>(context: ProjectDeletionContext, action: (tx: Executor) => Promise<T>) => withExclusiveDatabaseAdmission(db, 'dev-session.project-admission:' + context.target.id, async (tx) => {
    await sources.assertGrant(context); await registeredDevelopmentContent(tx);
    await tx.execute(sql`SELECT set_config('crewstation.dev_session_deletion',${context.operationId + ':' + context.generation + ':' + context.phase},true)`);
    if (context.phase !== 'seal') await renewAdmission(tx, context);
    if (context.phase === 'seal' || context.phase === 'metadata') await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended('dev-session.content-origins',0))`);
    const result = await action(tx); await sources.assertGrant(context); return result;
  });
  return {
    inspect: (target) => db.transaction(async (tx) => { await tx.execute(sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`); return inspection(tx, sources, target); }),
    seal: (context) => transact(context, async (tx) => {
      if (context.phase !== 'seal') throw precondition('开发清理范围只能在封写阶段受理');
      const old = (await tx.execute<{ operation_id: string; generation: number; revision: string; verified: boolean }>(sql`SELECT operation_id,generation,revision,verified FROM dev_session.project_deletions WHERE project_id=${context.target.id} FOR UPDATE`))[0];
      if (old && (old.operation_id !== context.operationId || old.generation > context.generation || old.revision !== context.confirmed.revision && old.generation >= context.generation)) throw precondition('开发原删除操作或世代被替换');
      if (old?.verified && old.revision === context.confirmed.revision) return true;
      const current = await inspection(tx, sources, context.target), verified = current.inventory.revision === context.confirmed.revision;
      for (const origin of current.origins) await registerDevelopmentOrigin(tx, origin);
      await tx.execute(sql`SELECT set_config('crewstation.dev_session_deletion_owner',${context.operationId + ':' + context.generation + ':seal'},true)`);
      await tx.execute(sql`INSERT INTO dev_session.project_admissions(project_id,operation_id,generation,revision)
        VALUES(${context.target.id},${context.operationId},${context.generation},${context.confirmed.revision}) ON CONFLICT DO NOTHING`);
      const admission = (await tx.execute<{ operation_id: string; generation: number; revision: string }>(sql`SELECT operation_id,generation,revision FROM dev_session.project_admissions WHERE project_id=${context.target.id} FOR UPDATE`))[0]!;
      if (admission.operation_id !== context.operationId || admission.generation > context.generation || admission.generation === context.generation && admission.revision !== context.confirmed.revision) throw precondition('开发原封写操作或世代不符');
      if (admission.generation < context.generation) await tx.execute(sql`UPDATE dev_session.project_admissions SET generation=${context.generation},revision=${context.confirmed.revision} WHERE project_id=${context.target.id}`);
      await tx.execute(sql`INSERT INTO dev_session.project_deletions(project_id,operation_id,generation,revision,body,verified)
        VALUES(${context.target.id},${context.operationId},${context.generation},${context.confirmed.revision},${JSON.stringify(current.scope)}::jsonb,${verified})
        ON CONFLICT(project_id) DO UPDATE SET generation=excluded.generation,revision=excluded.revision,body=excluded.body,verified=excluded.verified,phases='{}'::jsonb`);
      return verified;
    }),
    scope: (context) => transact(context, async (tx) => (await load(tx, context)).scope),
    proof: (context) => transact(context, async (tx) => {
      const state = await load(tx, context), index = PROJECT_DELETION_PHASES.indexOf(context.phase);
      if (index > 0 && !state.proofs[PROJECT_DELETION_PHASES[index - 1]!]) throw precondition('开发前一阶段的持久证明缺失');
      return state.proofs[context.phase];
    }),
    record: (context, raw) => transact(context, async (tx) => {
      const state = await load(tx, context), evidence = ProjectDeletionEvidenceSchema.parse(raw), index = PROJECT_DELETION_PHASES.indexOf(context.phase);
      if (index > 0 && !state.proofs[PROJECT_DELETION_PHASES[index - 1]!]) throw precondition('开发清理阶段不可跳过');
      if (state.proofs[context.phase] && jsonHash(state.proofs[context.phase]) !== jsonHash(evidence)) throw precondition('开发原阶段证明不能替换');
      await tx.execute(sql`UPDATE dev_session.project_deletions SET generation=${context.generation},phases=phases||${JSON.stringify({ [context.phase]: evidence })}::jsonb WHERE project_id=${context.target.id}`);
    }),
    exited: (birth) => exited(db, birth), observe: () => observeDevelopmentWork(db, sources.processes),
    legacyPending: (context) => legacyPending(db, context),
    pending: (context) => pending(db, context),
    captureStopped: (context) => transact(context, (tx) => captureDevelopmentStopped(tx, sources, context)),
    purge: (context) => transact(context, async (tx) => {
      const state = await load(tx, context);
      if (context.phase !== 'metadata' || !state.proofs.namespace) throw precondition('开发删除内容缺少前五阶段证明');
      if (!state.scope.compacted) for (const callback of state.scope.callbacks) if (!(await exited(tx, callback))) throw precondition('开发原回调仍未退出');
      if (!state.scope.compacted && await legacyPending(tx, context)) throw precondition('开发旧执行尚未收尾，不能把受理或断线当成原回调退出');
      await tx.execute(sql`UPDATE dev_session.project_deletions SET generation=${context.generation} WHERE project_id=${context.target.id}`);
      await purgeDevelopmentContent(tx, sources, context, state.scope);
      await tx.execute(sql`UPDATE dev_session.project_deletions SET body=${JSON.stringify({ ...state.scope, contents: [], callbacks: [], stopped: null, compacted: true })}::jsonb WHERE project_id=${context.target.id}`);
    }),
  };
}
