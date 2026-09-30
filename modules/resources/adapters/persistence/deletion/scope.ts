import type { ProjectId } from '@crewstation/contracts';
import type { Executor } from '@crewstation/persistence';
import { precondition } from '@crewstation/kernel';
import { sql } from 'drizzle-orm';

export const CONTENT = ['workload_stop_proofs', 'workload_stop_scans', 'workload_admission_closures', 'workload_consumers', 'task_storage_fences', 'task_volume_safety', 'children', 'aliases', 'leases', 'changes', 'records', 'project_locks'] as const;
export type ResourceContentTable = typeof CONTENT[number];
export async function registered(db: Executor): Promise<void> {
  const rows = await db.execute<{ table_name: string }>(sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'resources' AND table_type = 'BASE TABLE'`);
  const allowed: readonly string[] = [...CONTENT, 'deletion_fences', 'deletion_identities', 'deletion_stop_receipts', 'deletion_volume_receipts'];
  if (rows.some((row) => !allowed.includes(row.table_name))) throw precondition('资源台账存在未登记的内容表，停止清理');
}
export function resourceIds(projectId: ProjectId) {
  return sql`(SELECT id FROM resources.records WHERE project_id = ${projectId} UNION SELECT identity_key FROM resources.deletion_identities WHERE project_id = ${projectId} AND identity_kind = 'record')`;
}
export function taskIds(projectId: ProjectId, namespace: string) {
  return sql`(SELECT id FROM resources.records WHERE project_id = ${projectId} AND kind IN ('business-workspace','dev-workspace') UNION SELECT task_id FROM resources.workload_consumers WHERE resource_id IN ${resourceIds(projectId)} OR namespace = ${namespace} UNION SELECT identity_key FROM resources.deletion_identities WHERE project_id = ${projectId} AND identity_kind = 'task')`;
}
export function consumerIds(projectId: ProjectId, namespace: string) {
  return sql`(SELECT id FROM resources.workload_consumers WHERE resource_id IN ${resourceIds(projectId)} OR task_id IN ${taskIds(projectId, namespace)} OR namespace = ${namespace} UNION SELECT identity_key FROM resources.deletion_identities WHERE project_id = ${projectId} AND identity_kind = 'consumer')`;
}
export function contentWhere(table: ResourceContentTable, projectId: ProjectId, namespace: string) {
  if (table === 'records' || table === 'project_locks') return sql`project_id = ${projectId}`;
  if (table === 'changes') return sql`project_id = ${projectId} OR resource_id IN ${resourceIds(projectId)}`;
  if (['task_storage_fences', 'workload_stop_scans'].includes(table)) return sql`task_id IN ${taskIds(projectId, namespace)}`;
  if (table === 'workload_stop_proofs') return sql`consumer_id IN ${consumerIds(projectId, namespace)}`;
  if (table === 'workload_consumers') return sql`id IN ${consumerIds(projectId, namespace)}`;
  if (table === 'workload_admission_closures') return sql`id IN ${consumerIds(projectId, namespace)} OR identity->>'resourceId' IN ${resourceIds(projectId)} OR identity->'consumer'->>'taskId' IN ${taskIds(projectId, namespace)}`;
  return sql`resource_id IN ${resourceIds(projectId)}`;
}
export async function rememberIdentities(db: Executor, projectId: ProjectId, namespace: string) {
  await db.execute(sql`INSERT INTO resources.deletion_identities(project_id,identity_kind,identity_key) SELECT ${projectId},'record',id FROM resources.records WHERE project_id = ${projectId} ON CONFLICT DO NOTHING`);
  await db.execute(sql`INSERT INTO resources.deletion_identities(project_id,identity_kind,identity_key) SELECT ${projectId},'task',identity_key FROM ${taskIds(projectId, namespace)} AS owned(identity_key) ON CONFLICT DO NOTHING`);
  await db.execute(sql`INSERT INTO resources.deletion_identities(project_id,identity_kind,identity_key) SELECT ${projectId},'consumer',identity_key FROM ${consumerIds(projectId, namespace)} AS owned(identity_key) ON CONFLICT DO NOTHING`);
}
