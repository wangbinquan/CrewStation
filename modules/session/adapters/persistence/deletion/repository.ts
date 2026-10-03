import { PROJECT_DELETION_PHASES, ProjectDeletionEvidenceSchema } from '@crewstation/contracts';
import type { ProjectDeletionContext } from '@crewstation/contracts';
import { jsonHash, precondition } from '@crewstation/kernel';
import type { Database, Executor } from '@crewstation/persistence';
import { withExclusiveDatabaseAdmission } from '@crewstation/persistence';
import { sql } from 'drizzle-orm';
import { SessionDeletionProofsSchema, SessionDeletionScopeSchema } from '../../../domain/projectDeletion';
import type { SessionDeletionRepository, SessionDeletionSources } from '../../../ports/projectDeletion';
import { inspectSessionDeletion } from './inspection';
import { registerSessionTask, registeredSessionContent, SESSION_CONTENT } from './identity';
import { observeSessionTransports } from './recovery';

async function load(db: Executor, context: ProjectDeletionContext) {
  const row = (await db.execute<{ operation_id: string; generation: number; revision: string; body: unknown; phases: unknown; verified: boolean }>(sql`
    SELECT operation_id,generation,revision,body,phases,verified FROM session.project_deletions WHERE project_id=${context.target.id} FOR UPDATE`))[0];
  if (!row || row.operation_id !== context.operationId || row.generation > context.generation || row.revision !== context.confirmed.revision || !row.verified)
    throw precondition('会话清理原操作、世代或完整确认范围不符');
  return { scope: SessionDeletionScopeSchema.parse(row.body), proofs: SessionDeletionProofsSchema.parse(row.phases) };
}
export function sessionDeletionRepository(db: Database, sources: SessionDeletionSources): SessionDeletionRepository {
  const transact = <T>(context: ProjectDeletionContext, work: (tx: Executor) => Promise<T>) => withExclusiveDatabaseAdmission(db, 'session.project-admission:' + context.target.id, async (tx) => {
    await sources.assertGrant(context); await registeredSessionContent(tx);
    await tx.execute(sql`SELECT set_config('crewstation.session_deletion',${context.operationId + ':' + context.generation + ':' + context.phase},true)`);
    const result = await work(tx); await sources.assertGrant(context); return result;
  });
  return {
    inspect: (target) => db.transaction(async (tx) => { await tx.execute(sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`); return inspectSessionDeletion(tx, sources, target); }),
    seal: (context) => transact(context, async (tx) => {
      if (context.phase !== 'seal') throw precondition('会话清理范围只能在封写阶段受理');
      const existing = (await tx.execute<{ operation_id: string; generation: number; revision: string; body: unknown; verified: boolean }>(sql`
        SELECT operation_id,generation,revision,body,verified FROM session.project_deletions WHERE project_id=${context.target.id} FOR UPDATE`))[0];
      if (existing && (existing.operation_id !== context.operationId || existing.generation > context.generation
        || existing.revision !== context.confirmed.revision && existing.generation >= context.generation)) throw precondition('会话原操作或世代被替换');
      if (existing?.verified && existing.revision === context.confirmed.revision) return true;
      const current = await inspectSessionDeletion(tx, sources, context.target), verified = current.inventory.revision === context.confirmed.revision;
      for (const key of current.scope.taskKeys) await registerSessionTask(tx, sources, key);
      await tx.execute(sql`INSERT INTO session.project_deletions(project_id,operation_id,generation,revision,body,verified)
        VALUES(${context.target.id},${context.operationId},${context.generation},${context.confirmed.revision},${JSON.stringify(current.scope)}::jsonb,${verified})
        ON CONFLICT(project_id) DO UPDATE SET generation=excluded.generation,revision=excluded.revision,body=excluded.body,verified=excluded.verified,phases='{}'::jsonb`);
      return verified;
    }),
    scope: (context) => transact(context, async (tx) => (await load(tx, context)).scope),
    proof: (context) => transact(context, async (tx) => {
      const state = await load(tx, context), index = PROJECT_DELETION_PHASES.indexOf(context.phase);
      if (index > 0 && !state.proofs[PROJECT_DELETION_PHASES[index - 1]!]) throw precondition('会话前一阶段原持久证明缺失');
      return state.proofs[context.phase];
    }),
    record: (context, raw) => transact(context, async (tx) => {
      const state = await load(tx, context), evidence = ProjectDeletionEvidenceSchema.parse(raw), index = PROJECT_DELETION_PHASES.indexOf(context.phase);
      if (index > 0 && !state.proofs[PROJECT_DELETION_PHASES[index - 1]!]) throw precondition('会话阶段不可跳过');
      if (state.proofs[context.phase] && jsonHash(state.proofs[context.phase]) !== jsonHash(evidence)) throw precondition('会话原证明不可替换');
      await tx.execute(sql`UPDATE session.project_deletions SET generation=${context.generation},phases=phases||${JSON.stringify({ [context.phase]: evidence })}::jsonb WHERE project_id=${context.target.id}`);
    }),
    exited: async (birth) => {
      const row = (await db.execute<{ identity: string; exited_at: Date | null; exit_digest: string | null }>(sql`SELECT identity,exited_at,exit_digest FROM session.connection_births WHERE id=${birth.id}`))[0];
      return !!row && row.identity === birth.identity && row.exited_at !== null && row.exit_digest === birth.identity;
    },
    observe: () => observeSessionTransports(db, sources),
    purge: (context) => transact(context, async (tx) => {
      const state = await load(tx, context);
      if (context.phase !== 'metadata' || !state.proofs.namespace) throw precondition('会话删除内容缺少前五阶段证明');
      if (state.scope.compacted) return;
      for (const birth of state.scope.births) if (!(await tx.execute(sql`SELECT id FROM session.connection_births WHERE id=${birth.id} AND identity=${birth.identity} AND exited_at IS NOT NULL AND exit_digest=identity`)).length)
        throw precondition('会话原连接仍未退出');
      await tx.execute(sql`UPDATE session.project_deletions SET generation=${context.generation} WHERE project_id=${context.target.id}`);
      const selected = sql.join(state.scope.taskKeys.map((key) => sql`${key}`), sql`,`);
      if (state.scope.taskKeys.length) {
        for (const table of SESSION_CONTENT) await tx.execute(sql`DELETE FROM ${sql.raw('session.' + table)} WHERE task_id IN(${selected})`);
        await tx.execute(sql`DELETE FROM session.connection_births WHERE task_key IN(${selected})`);
      }
      await tx.execute(sql`UPDATE session.project_deletions SET body=${JSON.stringify({ ...state.scope, taskKeys: [], births: [], compacted: true })}::jsonb WHERE project_id=${context.target.id}`);
    }),
  };
}
