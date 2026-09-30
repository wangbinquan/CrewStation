import type { ProjectDeletionContext, ProjectDeletionInventory, ProjectId } from '@crewstation/contracts';
import { jsonHash, precondition } from '@crewstation/kernel';
import type { Database, Executor } from '@crewstation/persistence';
import { sql } from 'drizzle-orm';
import type { ConfigDeletionRepository } from '../../ports/deletion';

const CONTENT = ['version_entries', 'versions', 'items', 'definitions', 'value_sets'] as const;
async function registered(db: Executor) {
  const rows = await db.execute<{ table_name: string }>(sql`SELECT table_name FROM information_schema.columns WHERE table_schema = 'config' AND column_name = 'project_id'`);
  const allowed: readonly string[] = [...CONTENT, 'deletion_fences'];
  if (rows.some((r) => !allowed.includes(r.table_name))) throw precondition('配置模块存在未登记的项目内容表');
}
async function inspect(db: Executor, projectId: ProjectId): Promise<ProjectDeletionInventory> {
  await registered(db); const resources = [];
  for (const table of CONTENT) {
    const rows = await db.execute<{ count: string; fingerprint: string }>(sql`SELECT count(*)::text AS count,
      md5(coalesce(string_agg(md5(content::text), ',' ORDER BY md5(content::text)), '')) AS fingerprint
      FROM ${sql.identifier('config')}.${sql.identifier(table)} content WHERE project_id = ${projectId}`);
    const count = Number(rows[0]?.count), fingerprint = rows[0]?.fingerprint;
    if (!Number.isSafeInteger(count) || count < 0 || !fingerprint) throw precondition('配置内容盘点不完整');
    resources.push({ kind: table, id: projectId, identity: jsonHash({ table, count, fingerprint }), count, scope: 'metadata' as const });
  }
  return { participant: 'config', revision: jsonHash(resources), complete: true, resources, references: [], blockers: [] };
}
async function lock(db: Executor, context: ProjectDeletionContext) {
  await db.execute(sql`INSERT INTO config.deletion_fences(project_id) VALUES (${context.target.id}) ON CONFLICT DO NOTHING`);
  const rows = await db.execute<{ operation_id: string | null; generation: number; confirmed_revision: string | null }>(sql`SELECT operation_id,generation,confirmed_revision FROM config.deletion_fences WHERE project_id = ${context.target.id} FOR UPDATE`);
  const row = rows[0];
  if (!row || (row.operation_id && row.operation_id !== context.operationId) || row.generation > context.generation) throw precondition('配置删除屏障的操作或世代不符');
  return row;
}
export function configDeletionRepository(db: Database, assertGrant: (context: ProjectDeletionContext) => Promise<void>): ConfigDeletionRepository {
  const sealedWork = (context: ProjectDeletionContext, purge = false) => db.transaction(async (tx) => {
    const row = await lock(tx, context); await assertGrant(context);
    if (row.operation_id !== context.operationId || row.confirmed_revision !== context.confirmed.revision) throw precondition('配置持久闭准入屏障未完成');
    await tx.execute(sql`UPDATE config.deletion_fences SET generation = ${context.generation} WHERE project_id = ${context.target.id}`);
    if (purge) {
      await registered(tx); await tx.execute(sql`SELECT set_config('crewstation.config_deletion', ${context.operationId}, true)`);
      for (const table of CONTENT) await tx.execute(sql`DELETE FROM ${sql.identifier('config')}.${sql.identifier(table)} WHERE project_id = ${context.target.id}`);
      if ((await inspect(tx, context.target.id)).resources.some((r) => r.count !== 0)) throw precondition('配置清理没有归零');
    }
  });
  return {
    inspect: (id) => inspect(db, id),
    seal: (context) => db.transaction(async (tx) => {
      const row = await lock(tx, context); await assertGrant(context);
      const current = await inspect(tx, context.target.id);
      if (row.operation_id && row.confirmed_revision !== context.confirmed.revision && row.generation >= context.generation) throw precondition('配置确认摘要不能被替换');
      await tx.execute(sql`UPDATE config.deletion_fences SET operation_id = ${context.operationId}, generation = ${context.generation}, confirmed_revision = ${context.confirmed.revision} WHERE project_id = ${context.target.id}`);
      return current.revision === context.confirmed.revision;
    }),
    assertSealed: (context) => sealedWork(context), purge: (context) => sealedWork(context, true),
  };
}
