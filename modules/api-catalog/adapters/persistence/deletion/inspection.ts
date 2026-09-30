import type { ProjectDeletionInventory, ProjectDeletionTarget } from '@crewstation/contracts';
import { jsonHash, precondition } from '@crewstation/kernel';
import type { Executor } from '@crewstation/persistence';
import { sql } from 'drizzle-orm';
import { CONTENT, operations, owned, services } from './scope';

export async function registered(db: Executor) {
  const rows = await db.execute<{ table_name: string }>(sql`SELECT table_name FROM information_schema.tables WHERE table_schema='api_catalog' AND table_type='BASE TABLE'`);
  const allowed: readonly string[] = [...CONTENT, 'resource_identity_aliases', 'deletion_fences', 'deletion_entities'];
  if (rows.some((row) => !allowed.includes(row.table_name))) throw precondition('API 目录存在未登记的内容表');
}
export async function inspect(db: Executor, target: ProjectDeletionTarget): Promise<ProjectDeletionInventory> {
  await registered(db); const resources = [];
  const orphaned = await db.execute(sql`SELECT id FROM api_catalog.operations WHERE proxy_id NOT IN (SELECT id FROM api_catalog.proxies) AND id NOT IN (SELECT entity_id FROM api_catalog.deletion_entities WHERE kind='operation') LIMIT 1`);
  for (const table of CONTENT) {
    const [row] = await db.execute<{ count: string; fingerprint: string }>(sql`SELECT count(*)::text AS count,md5(coalesce(string_agg(md5(content::text),',' ORDER BY md5(content::text)),'')) AS fingerprint FROM ${sql.identifier('api_catalog')}.${sql.identifier(table)} content WHERE ${owned(table, target)}`);
    const count = Number(row?.count); if (!row?.fingerprint || !Number.isSafeInteger(count) || count < 0) throw precondition('API 目录内容盘点不完整');
    resources.push({ kind: table, id: target.id, identity: jsonHash({ table, count, fingerprint: row.fingerprint }), count, scope: 'metadata' as const });
  }
  const incoming = await db.execute<{ service_id: string; count: string; fingerprint: string }>(sql`SELECT service_id,count(*)::text AS count,md5(string_agg(md5(body::text),',' ORDER BY md5(body::text))) AS fingerprint FROM (
    SELECT service_id,to_jsonb(g) AS body FROM api_catalog.grants g WHERE operation_id IN (${operations(target)}) AND service_id NOT IN (${services(target)})
    UNION ALL SELECT service_id,to_jsonb(r) AS body FROM api_catalog.requests r WHERE operation_id IN (${operations(target)}) AND project_id<>${target.id}
  ) incoming GROUP BY service_id ORDER BY service_id`);
  const references = incoming.map((row) => ({ kind: 'api-consumer', id: row.service_id, description: `其他服务有 ${row.count} 条关联授权或申请；授权将失效，申请内容保留` }));
  const blockers = orphaned.length ? [{ participant: 'api-catalog' as const, code: 'ownership-unresolved', message: 'API 历史操作缺少原代理和项目归属，不能将未识别内容当作空范围' }] : [];
  return { participant: 'api-catalog', revision: jsonHash({ resources, incoming, blockers }), complete: !blockers.length, resources, references, blockers };
}
