import type { ProjectId } from '@crewstation/contracts';
import { jsonHash, precondition } from '@crewstation/kernel';
import type { ProjectDeletionInventory } from '@crewstation/contracts';
import type { Executor } from '@crewstation/persistence';
import { sql } from 'drizzle-orm';

/** 本模块所有内容表；新增 project_id 表而未登记将阻断删除。全局目录与最小删除记录不在清理集合内。 */
const CONTENT_TABLES = ['services', 'memberships', 'task_quotas', 'app_listings', 'app_access_requests', 'app_icons', 'service_plan_policies', 'namespace_quotas', 'resource_policy_receipts'] as const;
const AUDIT_TABLES = ['deletion_plans', 'deletion_operations'] as const;

async function assertRegistered(db: Executor) {
  const columns = await db.execute<{ table_name: string }>(sql`SELECT table_name FROM information_schema.columns WHERE table_schema = 'project' AND column_name = 'project_id'`);
  const unknown = columns.filter((c) => ![...CONTENT_TABLES, ...AUDIT_TABLES].some((t) => t === c.table_name));
  if (unknown.length) throw precondition('project 存在未登记的项目内容表', { tables: unknown.map((c) => c.table_name) });
}
export async function projectMetadataCount(db: Executor, projectId: ProjectId): Promise<number> {
  await assertRegistered(db); let count = 0;
  for (const table of CONTENT_TABLES) {
    const rows = await db.execute<{ count: string }>(sql`SELECT count(*)::text AS count FROM ${sql.identifier('project')}.${sql.identifier(table)} WHERE project_id = ${projectId}`);
    const value = Number(rows[0]?.count);
    if (!Number.isSafeInteger(value) || value < 0) throw precondition('项目元数据数量读取不完整'); count += value;
  }
  if (!Number.isSafeInteger(count)) throw precondition('项目元数据数量溢出'); return count;
}
export async function inspectProjectMetadata(db: Executor, projectId: ProjectId): Promise<ProjectDeletionInventory> {
  await assertRegistered(db); const resources = [];
  for (const table of CONTENT_TABLES) {
    const rows = await db.execute<{ count: string; fingerprint: string }>(sql`SELECT count(*)::text AS count,
      md5(coalesce(string_agg(md5(content::text), ',' ORDER BY md5(content::text)), '')) AS fingerprint
      FROM ${sql.identifier('project')}.${sql.identifier(table)} content WHERE project_id = ${projectId}`);
    const count = Number(rows[0]?.count), fingerprint = rows[0]?.fingerprint;
    if (!Number.isSafeInteger(count) || count < 0 || !fingerprint) throw precondition('项目内容盘点不完整');
    resources.push({ kind: table, id: projectId, identity: jsonHash({ table, count, fingerprint }), count, scope: 'metadata' as const });
  }
  return { participant: 'project', revision: jsonHash(resources), complete: true, resources, references: [], blockers: [] };
}
export async function purgeProjectMetadata(db: Executor, projectId: ProjectId, operationId: string): Promise<void> {
  await assertRegistered(db);
  await db.execute(sql`SELECT set_config('crewstation.project_deletion', ${operationId}, true)`);
  for (const table of CONTENT_TABLES) await db.execute(sql`DELETE FROM ${sql.identifier('project')}.${sql.identifier(table)} WHERE project_id = ${projectId}`);
}
