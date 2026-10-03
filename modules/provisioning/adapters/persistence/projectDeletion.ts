import { PROJECT_DELETION_PHASES, ProjectDeletionEvidenceSchema } from '@crewstation/contracts';
import type { ProjectDeletionContext } from '@crewstation/contracts';
import { jsonHash, precondition } from '@crewstation/kernel';
import type { Database, Executor } from '@crewstation/persistence';
import { withExclusiveDatabaseAdmission } from '@crewstation/persistence';
import { sql } from 'drizzle-orm';
import { ProvisioningDeletionProofsSchema, ProvisioningDeletionScopeSchema } from '../../domain/projectDeletion';
import type { ProvisioningDeletionRepository } from '../../ports/projectDeletion';

const columns: Readonly<Record<string, readonly string[]>> = {
  project_admissions: ['project_id', 'operation_id', 'generation', 'revision'],
  original_callbacks: ['id', 'project_id', 'service_id', 'kind', 'consumer_id', 'backend_pid', 'original_process', 'input_digest',
    'exit_key_hash', 'entered_at', 'exited_at', 'exit_digest', 'recovery_digest'],
  deletion_scopes: ['project_id', 'operation_id', 'generation', 'revision', 'body', 'phases'],
};
async function registered(db: Executor) {
  const owned = await db.execute<{ table_name: string }>(sql`SELECT table_name FROM information_schema.columns WHERE table_schema='provisioning' AND column_name='project_id' ORDER BY table_name`);
  if (jsonHash(owned.map((row) => row.table_name)) !== jsonHash(Object.keys(columns).sort())) throw precondition('开通模块存在未登记或缺失的项目内容表');
  for (const [table, expected] of Object.entries(columns)) {
    const actual = await db.execute<{ column_name: string }>(sql`SELECT column_name FROM information_schema.columns WHERE table_schema='provisioning' AND table_name=${table} ORDER BY column_name`);
    if (jsonHash(actual.map((row) => row.column_name)) !== jsonHash([...expected].sort())) throw precondition('开通项目内容列发生未登记变化');
  }
}
async function load(tx: Executor, context: ProjectDeletionContext) {
  const row = (await tx.execute<{ operation_id: string; generation: number; revision: string; body: unknown; phases: unknown }>(sql`
    SELECT operation_id,generation,revision,body,phases FROM provisioning.deletion_scopes WHERE project_id=${context.target.id} FOR UPDATE`))[0];
  if (!row || row.operation_id !== context.operationId || row.generation > context.generation || row.revision !== context.confirmed.revision)
    throw precondition('开通清理的原操作、确认摘要或世代不符');
  return { scope: ProvisioningDeletionScopeSchema.parse(row.body), proofs: ProvisioningDeletionProofsSchema.parse(row.phases) };
}
export function provisioningDeletionRepository(db: Database, assertGrant: (context: ProjectDeletionContext) => Promise<void>): ProvisioningDeletionRepository {
  const transact = <T>(context: ProjectDeletionContext, work: (tx: Executor) => Promise<T>) => withExclusiveDatabaseAdmission(db, 'provisioning.project-admission:' + context.target.id, async (tx) => {
    await assertGrant(context); await registered(tx);
    await tx.execute(sql`SELECT set_config('crewstation.provisioning_deletion_owner',${context.operationId + ':' + context.generation + ':' + context.phase},true)`);
    const result = await work(tx); await assertGrant(context); return result;
  });
  return {
    registered: () => registered(db),
    bind: (context, raw) => transact(context, async (tx) => {
      if (context.phase !== 'seal') throw precondition('只有封写阶段可以绑定原开通清理范围');
      const scope = ProvisioningDeletionScopeSchema.parse(raw);
      const existing = (await tx.execute<{ operation_id: string; generation: number; revision: string; body: unknown }>(sql`
        SELECT operation_id,generation,revision,body FROM provisioning.deletion_scopes WHERE project_id=${context.target.id} FOR UPDATE`))[0];
      if (existing && (existing.operation_id !== context.operationId || existing.generation > context.generation
        || existing.revision !== context.confirmed.revision && existing.generation >= context.generation
        || existing.revision === context.confirmed.revision && jsonHash(existing.body) !== jsonHash(scope))) throw precondition('原开通清理范围不能被替换');
      if (!existing) await tx.execute(sql`INSERT INTO provisioning.deletion_scopes(project_id,operation_id,generation,revision,body)
        VALUES(${context.target.id},${context.operationId},${context.generation},${context.confirmed.revision},${JSON.stringify(scope)}::jsonb)`);
      else if (existing.revision !== context.confirmed.revision) await tx.execute(sql`UPDATE provisioning.deletion_scopes SET generation=${context.generation},
        revision=${context.confirmed.revision},body=${JSON.stringify(scope)}::jsonb,phases='{}'::jsonb WHERE project_id=${context.target.id}`);
    }),
    read: (context) => transact(context, (tx) => load(tx, context)),
    record: (context, raw) => transact(context, async (tx) => {
      const state = await load(tx, context), evidence = ProjectDeletionEvidenceSchema.parse(raw), index = PROJECT_DELETION_PHASES.indexOf(context.phase);
      if (index > 0 && !state.proofs[PROJECT_DELETION_PHASES[index - 1]!]) throw precondition('开通前一阶段持久证明缺失');
      if (state.proofs[context.phase] && jsonHash(state.proofs[context.phase]) !== jsonHash(evidence)) throw precondition('开通阶段证明不能被不同结果覆盖');
      await tx.execute(sql`UPDATE provisioning.deletion_scopes SET generation=${context.generation},phases=phases||${JSON.stringify({ [context.phase]: evidence })}::jsonb WHERE project_id=${context.target.id}`);
    }),
    purgeCallbacks: (context) => transact(context, async (tx) => {
      const state = await load(tx, context);
      if (context.phase !== 'metadata' || !state.proofs.namespace) throw precondition('开通清理前五阶段尚未完成');
      if (state.scope.compacted) return;
      await tx.execute(sql`UPDATE provisioning.deletion_scopes SET generation=${context.generation} WHERE project_id=${context.target.id}`);
      await tx.execute(sql`DELETE FROM provisioning.original_callbacks WHERE project_id=${context.target.id}`);
      if ((await tx.execute(sql`SELECT id FROM provisioning.original_callbacks WHERE project_id=${context.target.id}`)).length) throw precondition('开通原回调内容没有归零');
      const compacted = { ...state.scope, callbacks: [], contents: [], compacted: true };
      await tx.execute(sql`UPDATE provisioning.deletion_scopes SET body=${JSON.stringify(compacted)}::jsonb WHERE project_id=${context.target.id}`);
    }),
  };
}
