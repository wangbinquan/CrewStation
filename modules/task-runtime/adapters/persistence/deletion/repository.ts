import { PROJECT_DELETION_PHASES, ProjectDeletionEvidenceSchema } from '@crewstation/contracts';
import type { ProjectDeletionContext } from '@crewstation/contracts';
import { jsonHash, precondition } from '@crewstation/kernel';
import { withExclusiveDatabaseAdmission } from '@crewstation/persistence';
import type { Database, Executor } from '@crewstation/persistence';
import { sql } from 'drizzle-orm';
import { RuntimeStoppedScopeSchema } from '../../../domain/deletion/projectDeletion';
import type { RuntimeDeletionRepository } from '../../../ports/deletion/projectDeletion';
import type { RuntimeWorkSources } from '../../../ports/deletion/work';
import { registeredRuntimeContent } from './inspection';
import { runtimeProjectAdmissionKey } from './projectWork';
import { observeRuntimeWork } from './workRecovery';
import { inspectRuntimeScope, loadRuntimeScope, registerRuntimeScopeOrigins, renewRuntimeAdmission, runtimeCallbackExited } from './scopeStore';
import { purgeRuntimeContent } from './purge';

async function seal(db: Executor, sources: RuntimeWorkSources, context: ProjectDeletionContext) {
  if (context.phase !== 'seal') throw precondition('运行清理范围只能在封写阶段受理');
  const old = (await db.execute<{ operation_id: string; generation: number; revision: string; verified: boolean }>(sql`
    SELECT operation_id,generation,revision,verified FROM task_runtime.project_deletions WHERE project_id=${context.target.id} FOR UPDATE`))[0];
  if (old && (old.operation_id !== context.operationId || old.generation > context.generation || old.revision !== context.confirmed.revision && old.generation >= context.generation))
    throw precondition('运行原删除操作或世代被替换');
  await renewRuntimeAdmission(db, context, true);
  if (old?.verified && old.revision === context.confirmed.revision) {
    await db.execute(sql`UPDATE task_runtime.project_deletions SET generation=${context.generation} WHERE project_id=${context.target.id}`);
    return true;
  }
  const current = await inspectRuntimeScope(db, sources, context.target), verified = current.inventory.revision === context.confirmed.revision;
  await registerRuntimeScopeOrigins(db, context, current);
  await db.execute(sql`INSERT INTO task_runtime.project_deletions(project_id,operation_id,generation,revision,body,verified)
    VALUES(${context.target.id},${context.operationId},${context.generation},${context.confirmed.revision},${JSON.stringify(current.scope)}::jsonb,${verified})
    ON CONFLICT(project_id) DO UPDATE SET generation=excluded.generation,revision=excluded.revision,body=excluded.body,verified=excluded.verified,phases='{}'::jsonb`);
  return verified;
}
export function runtimeDeletionRepository(db: Database, sources: RuntimeWorkSources): RuntimeDeletionRepository {
  const transact = <T>(context: ProjectDeletionContext, action: (tx: Executor) => Promise<T>) => withExclusiveDatabaseAdmission(db, runtimeProjectAdmissionKey(context.target.id), async (tx) => {
    await sources.assertGrant(context); await registeredRuntimeContent(tx);
    await tx.execute(sql`SELECT set_config('crewstation.task_runtime_deletion',${context.operationId + ':' + context.generation + ':' + context.phase},true)`);
    if (context.phase === 'seal' || context.phase === 'metadata') await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended('task-runtime.content-origins',0))`);
    if (context.phase !== 'seal') await renewRuntimeAdmission(tx, context);
    const result = await action(tx); await sources.assertGrant(context); return result;
  });
  return {
    inspect: (target) => db.transaction((tx) => inspectRuntimeScope(tx, sources, target), { isolationLevel: 'repeatable read', accessMode: 'read only' }),
    seal: (context) => transact(context, (tx) => seal(tx, sources, context)),
    scope: (context) => transact(context, async (tx) => (await loadRuntimeScope(tx, context)).scope),
    proof: (context) => transact(context, async (tx) => {
      const state = await loadRuntimeScope(tx, context), index = PROJECT_DELETION_PHASES.indexOf(context.phase);
      if (index > 0 && !state.proofs[PROJECT_DELETION_PHASES[index - 1]!]) throw precondition('运行前一阶段的持久证明缺失');
      return state.proofs[context.phase];
    }),
    record: (context, raw) => transact(context, async (tx) => {
      const state = await loadRuntimeScope(tx, context), evidence = ProjectDeletionEvidenceSchema.parse(raw), index = PROJECT_DELETION_PHASES.indexOf(context.phase);
      if (index > 0 && !state.proofs[PROJECT_DELETION_PHASES[index - 1]!]) throw precondition('运行清理阶段不可跳过');
      if (state.proofs[context.phase] && jsonHash(state.proofs[context.phase]) !== jsonHash(evidence)) throw precondition('运行原阶段证明不能替换');
      await tx.execute(sql`UPDATE task_runtime.project_deletions SET generation=${context.generation},phases=phases||${JSON.stringify({ [context.phase]: evidence })}::jsonb WHERE project_id=${context.target.id}`);
    }),
    exited: (callback) => runtimeCallbackExited(db, callback), observe: () => observeRuntimeWork(db, sources.processes),
    pending: (context) => transact(context, async (tx) => (await tx.execute(sql`SELECT id FROM task_runtime.original_callbacks
      WHERE project_id=${context.target.id} AND exited_at IS NULL LIMIT 1`)).length !== 0),
    captureStopped: (context, rawStop) => transact(context, async (tx) => {
      const { scope, proofs } = await loadRuntimeScope(tx, context);
      if (context.phase !== 'stop' || !proofs.seal || scope.compacted) throw precondition('运行停止快照缺少原封写证明');
      if (scope.stopped) {
        if (!proofs.stop) throw precondition('运行停止范围缺少原子持久证明');
        return scope;
      }
      for (const callback of scope.callbacks) if (!(await runtimeCallbackExited(tx, callback))) throw precondition('运行原回调仍未退出');
      const current = await inspectRuntimeScope(tx, sources, context.target), contents = current.contents, callbacks = current.scope.callbacks;
      const stopped = RuntimeStoppedScopeSchema.parse({ contents, callbacks, count: contents.length, digest: jsonHash({ contents, callbacks }) });
      const stop = ProjectDeletionEvidenceSchema.parse(rawStop);
      if (scope.count && stop.kind === 'not-applicable') throw precondition('非空运行范围缺少实际停止与数字排空证明');
      const evidence = { kind: stop.kind, count: stopped.count, digest: jsonHash({ operationId: context.operationId, phase: context.phase, snapshot: stopped.digest, stop }),
        description: '原回调、执行停止和数字排空证明与停止后的完整内容快照已原子持久化' };
      await tx.execute(sql`UPDATE task_runtime.project_deletions SET generation=${context.generation},body=${JSON.stringify({ ...scope, stopped })}::jsonb,
        phases=phases||${JSON.stringify({ stop: evidence })}::jsonb WHERE project_id=${context.target.id}`);
      return { ...scope, stopped };
    }),
    purge: (context) => transact(context, async (tx) => {
      const { scope, proofs } = await loadRuntimeScope(tx, context);
      if (context.phase !== 'metadata' || !proofs.namespace) throw precondition('运行内容删除缺少前五阶段证明');
      if (scope.compacted) {
        if (!proofs.metadata) throw precondition('运行内容已压缩但原子回执缺失');
        return proofs.metadata;
      }
      await tx.execute(sql`UPDATE task_runtime.project_deletions SET generation=${context.generation} WHERE project_id=${context.target.id}`);
      const evidence = await purgeRuntimeContent(tx, sources, context, scope);
      await tx.execute(sql`UPDATE task_runtime.project_deletions SET body=${JSON.stringify({ ...scope, contents: [], callbacks: [], stopped: null, compacted: true })}::jsonb,
        phases=phases||${JSON.stringify({ metadata: evidence })}::jsonb WHERE project_id=${context.target.id}`);
      return evidence;
    }),
  };
}
