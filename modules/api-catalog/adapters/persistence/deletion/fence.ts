import type { ProjectDeletionContext } from '@crewstation/contracts';
import { precondition } from '@crewstation/kernel';
import type { Executor } from '@crewstation/persistence';
import { sql } from 'drizzle-orm';
import { services } from './scope';

export async function seedServiceIdentities(db: Executor, context: ProjectDeletionContext) {
  await db.execute(sql`INSERT INTO api_catalog.deletion_entities(kind,entity_id,project_id) SELECT 'service',id,${context.target.id} FROM (${services(context.target)}) AS s(id) ON CONFLICT DO NOTHING`);
  const conflicting = await db.execute(sql`SELECT entity_id FROM api_catalog.deletion_entities WHERE kind='service' AND entity_id IN (${services(context.target)}) AND project_id<>${context.target.id}`);
  if (conflicting.length) throw precondition('API 目录服务归属与原项目不符');
  await db.execute(sql`INSERT INTO api_catalog.deletion_entities(kind,entity_id,project_id) SELECT 'allocation',operation_id,${context.target.id} FROM api_catalog.allocation_receipts WHERE service_id IN (${services(context.target)}) ON CONFLICT DO NOTHING`);
}
export async function lock(db: Executor, context: ProjectDeletionContext) {
  await db.execute(sql`INSERT INTO api_catalog.deletion_fences(project_id) VALUES (${context.target.id}) ON CONFLICT DO NOTHING`);
  const [row] = await db.execute<{ operation_id: string | null; generation: number; confirmed_revision: string | null; scope_verified: boolean }>(sql`SELECT operation_id,generation,confirmed_revision,scope_verified FROM api_catalog.deletion_fences WHERE project_id=${context.target.id} FOR UPDATE`);
  if (!row || row.operation_id && row.operation_id !== context.operationId || row.generation > context.generation) throw precondition('API 目录删除屏障的操作或世代不符');
  return row;
}
export async function assertSealed(db: Executor, context: ProjectDeletionContext) {
  const row = await lock(db, context);
  if (row.operation_id !== context.operationId || row.confirmed_revision !== context.confirmed.revision || !row.scope_verified) throw precondition('API 目录持久闭准入屏障未完成');
  await db.execute(sql`UPDATE api_catalog.deletion_fences SET generation=${context.generation} WHERE project_id=${context.target.id}`);
}
