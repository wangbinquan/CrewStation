import type { ProjectDeletionContext, ProjectId } from '@crewstation/contracts';
import type { Database, Executor } from '@crewstation/persistence';
import { withSharedDatabaseAdmission, withExclusiveDatabaseAdmission } from '@crewstation/persistence';
import { precondition } from '@crewstation/kernel';
import { sql } from 'drizzle-orm';
import type { ResourceDeletionRepository } from '../../../ports/deletion';
import { inspectLedgerDeletion } from './inventory';
import { CONTENT, contentWhere, registered, rememberIdentities } from './scope';

const key = (id: ProjectId) => `resources.project-admission:${id}`;
export async function assertResourceDeletionFence(db: Executor, context: ProjectDeletionContext, participant: 'resources' | 'cluster-control') {
  const rows = await db.execute<{ operation_id: string | null; generation: number; confirmed_revision: string | null; cluster_revision: string | null }>(sql`SELECT operation_id,generation,confirmed_revision,cluster_revision FROM resources.deletion_fences WHERE project_id = ${context.target.id} FOR UPDATE`);
  const row = rows[0], revision = participant === 'resources' ? row?.confirmed_revision : row?.cluster_revision;
  if (!row || row.operation_id !== context.operationId || row.generation > context.generation || revision !== context.confirmed.revision) throw precondition('资源清理的持久许可或原世代不符');
  await db.execute(sql`UPDATE resources.deletion_fences SET generation = ${context.generation} WHERE project_id = ${context.target.id}`);
}
export function resourceDeletionRepository(db: Database, assertGrant: (context: ProjectDeletionContext) => Promise<void>, available?: (id: ProjectId) => Promise<void>): ResourceDeletionRepository {
  return {
    inspect: (id, namespace) => inspectLedgerDeletion(db, id, namespace),
    seal: (context) => withExclusiveDatabaseAdmission(db, key(context.target.id), async (tx) => {
      if (context.phase !== 'seal' || context.confirmed.participant !== 'resources') throw precondition('台账闭准入许可来源或阶段不符');
      await assertGrant(context);
      await tx.execute(sql`INSERT INTO resources.deletion_fences(project_id) VALUES (${context.target.id}) ON CONFLICT DO NOTHING`);
      const previous = await tx.execute<{ operation_id: string | null; generation: number; confirmed_revision: string | null }>(sql`SELECT operation_id,generation,confirmed_revision FROM resources.deletion_fences WHERE project_id = ${context.target.id} FOR UPDATE`);
      const row = previous[0]!;
      if (row.operation_id && (row.operation_id !== context.operationId || row.generation > context.generation || row.confirmed_revision && row.confirmed_revision !== context.confirmed.revision)) throw precondition('资源清理确认材料不能替换');
      const report = await inspectLedgerDeletion(tx, context.target.id, context.target.namespace);
      await rememberIdentities(tx, context.target.id, context.target.namespace);
      await tx.execute(sql`UPDATE resources.deletion_fences SET operation_id = ${context.operationId},generation = ${context.generation},confirmed_revision = ${context.confirmed.revision} WHERE project_id = ${context.target.id}`);
      const expected = context.confirmed.resources.filter((entry) => entry.kind.startsWith('metadata:'));
      // 其他 owner 的 seal 会追加停止扫描或关闭消费者；这些内容仍在原记录范围内。
      const scope = report.resources.find((entry) => entry.kind === 'metadata:records')!;
      return expected.some((entry) => entry.kind === scope.kind && entry.identity === scope.identity && entry.count === scope.count) && expected.length === report.resources.length && !report.blockers.length;
    }),
    assertSealed: (context) => db.transaction(async (tx) => { await assertGrant(context); await assertResourceDeletionFence(tx, context, 'resources'); }),
    purgeMetadata: (context) => db.transaction(async (tx) => {
      if (context.phase !== 'metadata' || context.confirmed.participant !== 'resources') throw precondition('台账元数据清理许可阶段不符');
      await assertGrant(context); await assertResourceDeletionFence(tx, context, 'resources'); await registered(tx);
      if ((await inspectLedgerDeletion(tx, context.target.id, context.target.namespace)).blockers.length) throw precondition('资源出现跨项目引用，停止元数据清理');
      await rememberIdentities(tx, context.target.id, context.target.namespace);
      await tx.execute(sql`SELECT set_config('crewstation.resources_deletion', ${context.operationId}, true)`);
      await tx.execute(sql`UPDATE resources.deletion_fences SET retired = true WHERE project_id = ${context.target.id}`);
      for (const table of CONTENT) await tx.execute(sql`DELETE FROM ${sql.identifier('resources')}.${sql.identifier(table)} WHERE ${contentWhere(table, context.target.id, context.target.namespace)}`);
      if ((await inspectLedgerDeletion(tx, context.target.id, context.target.namespace)).resources.some((entry) => entry.count !== 0)) throw precondition('资源台账及历史证明仍有残留');
    }),
    withAdmission: (id, work) => withSharedDatabaseAdmission(db, key(id), async (tx) => {
      const rows = await tx.execute<{ operation_id: string | null }>(sql`SELECT operation_id FROM resources.deletion_fences WHERE project_id = ${id}`);
      if (rows[0]?.operation_id) return false;
      await available?.(id); await work(); return true;
    }),
  };
}
export async function sealClusterDeletionAdmission(db: Database, context: ProjectDeletionContext, assertGrant: (context: ProjectDeletionContext) => Promise<void>) {
  if (context.phase !== 'seal' || context.confirmed.participant !== 'cluster-control') throw precondition('集群闭准入许可来源或阶段不符');
  await withExclusiveDatabaseAdmission(db, key(context.target.id), async (tx) => {
    await assertGrant(context);
    await tx.execute(sql`INSERT INTO resources.deletion_fences(project_id) VALUES (${context.target.id}) ON CONFLICT DO NOTHING`);
    const rows = await tx.execute<{ operation_id: string | null; generation: number; cluster_revision: string | null }>(sql`SELECT operation_id,generation,cluster_revision FROM resources.deletion_fences WHERE project_id = ${context.target.id} FOR UPDATE`);
    const row = rows[0]!;
    if (row.operation_id && (row.operation_id !== context.operationId || row.generation > context.generation || row.cluster_revision && row.cluster_revision !== context.confirmed.revision)) throw precondition('集群清理准入许可不可替换');
    await tx.execute(sql`UPDATE resources.deletion_fences SET operation_id = ${context.operationId},generation = ${context.generation},cluster_revision = ${context.confirmed.revision} WHERE project_id = ${context.target.id}`);
  });
}
export async function assertClusterDeletionAdmission(db: Database, context: ProjectDeletionContext, assertGrant: (context: ProjectDeletionContext) => Promise<void>) {
  if (context.confirmed.participant !== 'cluster-control') throw precondition('集群闭准入许可来源不符');
  await db.transaction(async (tx) => { await assertGrant(context); await assertResourceDeletionFence(tx, context, 'cluster-control'); });
}
