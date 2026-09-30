import type { ProjectDeletionInventory, ProjectId } from '@crewstation/contracts';
import type { Executor } from '@crewstation/persistence';
import { jsonHash, precondition } from '@crewstation/kernel';
import { sql } from 'drizzle-orm';
import { CONTENT, contentWhere, registered, resourceIds } from './scope';

export async function inspectLedgerDeletion(db: Executor, projectId: ProjectId, namespace: string): Promise<ProjectDeletionInventory> {
  await registered(db); const resources = [];
  for (const table of CONTENT) {
    // 记录归属与期望是范围；状态、时钟和关闭消费者的进展不能改变原资源身份。
    const material = table === 'records' ? sql`jsonb_build_object('id',id,'kind',kind,'project_id',project_id,'parent_id',parent_id,'owner_module',owner_module,'owner_ref',owner_ref,'spec',spec)::text` : sql`content::text`;
    const rows = await db.execute<{ count: string; fingerprint: string }>(sql`SELECT count(*)::text AS count, md5(coalesce(string_agg(md5(${material}), ',' ORDER BY md5(${material})), '')) AS fingerprint FROM ${sql.identifier('resources')}.${sql.identifier(table)} content WHERE ${contentWhere(table, projectId, namespace)}`);
    const count = Number(rows[0]?.count), fingerprint = rows[0]?.fingerprint;
    if (!Number.isSafeInteger(count) || count < 0 || !fingerprint) throw precondition('资源台账盘点不完整');
    resources.push({ kind: `metadata:${table}`, id: projectId, count, identity: jsonHash({ table, count, fingerprint }), scope: 'metadata' as const });
  }
  const external = await db.execute<{ count: string }>(sql`SELECT count(*)::text AS count FROM resources.records WHERE project_id IS DISTINCT FROM ${projectId} AND (parent_id IN ${resourceIds(projectId)} OR id IN (SELECT resource_id FROM resources.workload_consumers WHERE namespace = ${namespace}))`);
  const blockers: ProjectDeletionInventory['blockers'] = Number(external[0]?.count) ? [{ participant: 'resources', code: 'shared-resource', message: '其他项目的资源仍引用本项目父记录；需先解除跨项目依赖' }] : [];
  return { participant: 'resources', complete: true, resources, revision: jsonHash(resources), references: [], blockers };
}
