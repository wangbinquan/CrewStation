import type { ProjectDeletionInventory, ProjectDeletionTarget } from '@crewstation/contracts';
import { jsonHash, precondition } from '@crewstation/kernel';
import type { Executor } from '@crewstation/persistence';
import { sql } from 'drizzle-orm';
import { CONTENT, owned, typeIds } from './scope';

export async function registered(db: Executor) {
  const rows = await db.execute<{ table_name: string }>(sql`SELECT table_name FROM information_schema.tables WHERE table_schema='events' AND table_type='BASE TABLE'`);
  const allowed: readonly string[] = [...CONTENT,'resource_identity_aliases','deletion_fences','deletion_entities','deletion_links','deletion_process_stops'];
  if (rows.some((row) => !allowed.includes(row.table_name))) throw precondition('事件模块存在未登记的内容表');
}
async function unresolved(db: Executor) {
  const rows = await db.execute(sql`SELECT id FROM events.event_types WHERE id NOT IN (SELECT entity_key FROM events.deletion_entities WHERE kind='event-type')
    UNION ALL SELECT id FROM events.inbox WHERE id NOT IN (SELECT entity_key FROM events.deletion_entities WHERE kind='event')
    UNION ALL SELECT id FROM events.deliveries WHERE event_id NOT IN (SELECT entity_key FROM events.deletion_entities WHERE kind='event')
    UNION ALL SELECT id FROM events.subscriptions WHERE event_type_id NOT IN (SELECT entity_key FROM events.deletion_entities WHERE kind='event-type') LIMIT 1`);
  return rows.length !== 0;
}
export async function inspect(db: Executor, target: ProjectDeletionTarget): Promise<ProjectDeletionInventory> {
  await registered(db); const resources = [];
  for (const table of CONTENT) {
    const projection = table === 'deletion_work' ? sql`jsonb_build_object('delivery_id',content.delivery_id,'generation',content.generation,'backend_pid',content.backend_pid,'pod_uid',content.pod_uid,'container_id',content.container_id,'node_uid',content.node_uid,'node_name',content.node_name)` : sql`to_jsonb(content)`;
    const [row] = await db.execute<{ count: string; fingerprint: string }>(sql`SELECT count(*)::text AS count,md5(coalesce(string_agg(md5(${projection}::text),',' ORDER BY md5(${projection}::text)),'')) AS fingerprint FROM ${sql.identifier('events')}.${sql.identifier(table)} content WHERE ${owned(table,target)}`);
    const count = Number(row?.count); if (!row?.fingerprint || !Number.isSafeInteger(count) || count < 0) throw precondition('事件内容盘点不完整');
    resources.push({ kind: table, id: target.id, identity: jsonHash({ table,count,fingerprint: row.fingerprint }), count, scope: 'metadata' as const });
  }
  const incoming = await db.execute<{ project_id: string; count: string; fingerprint: string }>(sql`SELECT project_id,count(*)::text AS count,md5(string_agg(md5(to_jsonb(s)::text),',' ORDER BY md5(to_jsonb(s)::text))) AS fingerprint FROM events.subscriptions s WHERE event_type_id IN (${typeIds(target)}) AND project_id<>${target.id} GROUP BY project_id ORDER BY project_id`);
  const references = incoming.map((row) => ({ kind: 'event-subscriber',id: row.project_id,description: `其他项目有 ${row.count} 条关联订阅；本来源停止，订阅配置保留并暂停` }));
  const blockers = await unresolved(db) ? [{ participant: 'events' as const,code: 'ownership-unresolved',message: '事件历史缺少原生产方、事件或类型归属，不能视为已完整盘点' }] : [];
  return { participant: 'events',revision: jsonHash({ resources,incoming,blockers }),complete: !blockers.length,resources,references,blockers };
}
