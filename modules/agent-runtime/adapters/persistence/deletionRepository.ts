import type { ProjectDeletionContext, ProjectDeletionInventory, ProjectDeletionTarget } from '@crewstation/contracts';
import { jsonHash, precondition } from '@crewstation/kernel';
import type { Database, Executor } from '@crewstation/persistence';
import { sql } from 'drizzle-orm';
import type { ComputeDeletionRepository } from '../../ports/deletion';

const CONTENT = ['project_compute_policies', 'allocation_receipts'] as const;
const GLOBAL = ['profiles', 'profile_revisions', 'profile_credentials', 'profile_tests', 'credential_versions', 'resource_identity_aliases', 'retired_profile_identities', 'retired_step_identities', 'retired_test_identities'] as const;
async function registered(db: Executor) {
  const rows = await db.execute<{ table_name: string }>(sql`SELECT table_name FROM information_schema.tables WHERE table_schema='agent_runtime' AND table_type='BASE TABLE'`);
  const allowed: readonly string[] = [...CONTENT, ...GLOBAL, 'deletion_fences', 'deletion_identities'];
  if (rows.some((r) => !allowed.includes(r.table_name))) throw precondition('算力模块存在未登记的内容表');
}
async function inspect(db: Executor, target: ProjectDeletionTarget): Promise<ProjectDeletionInventory> {
  await registered(db); const resources = [];
  for (const table of CONTENT) {
    const [row] = await db.execute<{ count: string; fingerprint: string }>(sql`SELECT count(*)::text AS count,md5(coalesce(string_agg(md5(content::text),',' ORDER BY md5(content::text)),'')) AS fingerprint FROM ${sql.identifier('agent_runtime')}.${sql.identifier(table)} content WHERE project_id=${target.id}`);
    const count = Number(row?.count);
    if (!row?.fingerprint || !Number.isSafeInteger(count) || count < 0) throw precondition('项目算力内容盘点不完整');
    resources.push({ kind: table, id: target.id, identity: jsonHash({ table, count, fingerprint: row.fingerprint }), count, scope: 'metadata' as const });
  }
  return { participant: 'agent-runtime', revision: jsonHash(resources), complete: true, resources, references: [], blockers: [] };
}
async function lock(db: Executor, context: ProjectDeletionContext) {
  await db.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`agent-runtime.project-admission:${context.target.id}`},0))`);
  await db.execute(sql`INSERT INTO agent_runtime.deletion_fences(project_id) VALUES (${context.target.id}) ON CONFLICT DO NOTHING`);
  const [row] = await db.execute<{ operation_id: string | null; generation: number; confirmed_revision: string | null; scope_verified: boolean }>(sql`SELECT operation_id,generation,confirmed_revision,scope_verified FROM agent_runtime.deletion_fences WHERE project_id=${context.target.id} FOR UPDATE`);
  if (!row || row.operation_id && row.operation_id !== context.operationId || row.generation > context.generation) throw precondition('算力删除屏障的操作或世代不符');
  return row;
}
async function assertSealed(db: Executor, context: ProjectDeletionContext) {
  const row = await lock(db, context);
  if (row.operation_id !== context.operationId || row.confirmed_revision !== context.confirmed.revision || !row.scope_verified) throw precondition('算力持久闭准入屏障未完成');
  await db.execute(sql`UPDATE agent_runtime.deletion_fences SET generation=${context.generation} WHERE project_id=${context.target.id}`);
}
export function computeDeletionRepository(db: Database, assertGrant?: (context: ProjectDeletionContext) => Promise<void>): ComputeDeletionRepository {
  const permitted = async (context: ProjectDeletionContext) => {
    if (!assertGrant) throw precondition('项目删除许可端口尚未装配');
    await assertGrant(context);
  };
  return {
    inspect: (target) => inspect(db, target),
    assertAvailable: async (projectId) => {
      const rows = await db.execute(sql`SELECT project_id FROM agent_runtime.deletion_fences WHERE project_id=${projectId} AND operation_id IS NOT NULL`);
      if (rows.length) throw precondition('项目算力和构建凭据已关闭');
    },
    seal: (context) => db.transaction(async (tx) => {
      const row = await lock(tx, context); await permitted(context);
      const renewed = Boolean(row.operation_id && !row.scope_verified && row.generation < context.generation && row.confirmed_revision !== context.confirmed.revision);
      if (row.operation_id && row.confirmed_revision !== context.confirmed.revision && !renewed) throw precondition('算力确认摘要不能被替换');
      if (row.operation_id && !renewed) { if (!row.scope_verified) return false; await assertSealed(tx, context); return true; }
      const current = await inspect(tx, context.target);
      await tx.execute(sql`UPDATE agent_runtime.deletion_fences SET operation_id=${context.operationId},generation=${context.generation},confirmed_revision=${context.confirmed.revision},scope_verified=${current.revision === context.confirmed.revision} WHERE project_id=${context.target.id}`);
      return current.revision === context.confirmed.revision;
    }),
    assertSealed: (context) => db.transaction(async (tx) => { await assertSealed(tx, context); await permitted(context); }),
    purge: (context) => db.transaction(async (tx) => {
      await assertSealed(tx, context); await permitted(context); await registered(tx);
      await tx.execute(sql`SELECT set_config('crewstation.compute_deletion',${context.operationId},true)`);
      for (const table of CONTENT) await tx.execute(sql`DELETE FROM ${sql.identifier('agent_runtime')}.${sql.identifier(table)} WHERE project_id=${context.target.id}`);
      if ((await inspect(tx, context.target)).resources.some((r) => r.count !== 0)) throw precondition('项目算力内容清理没有归零');
    }),
  };
}
