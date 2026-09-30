import type { ProjectDeletionContext } from '@crewstation/contracts';
import type { Executor } from '@crewstation/persistence';
import { sql } from 'drizzle-orm';
import { operations, services } from './scope';

/** 只使其他调用方关联失效，其理由、申请者与既有裁决材料仍归调用方。 */
export async function disable(db: Executor, context: ProjectDeletionContext) {
  await db.execute(sql`SELECT set_config('crewstation.api_catalog_deletion',${context.operationId},true)`);
  await db.execute(sql`UPDATE api_catalog.operations SET state='removed',updated_at=now() WHERE id IN (${operations(context.target)}) AND state<>'removed'`);
  await db.execute(sql`UPDATE api_catalog.proxies SET state='removed',updated_at=now() WHERE project_id=${context.target.id} AND state<>'removed'`);
  await db.execute(sql`UPDATE api_catalog.grants SET state='revoked',revoked_at=now() WHERE operation_id IN (${operations(context.target)}) AND state='granted'`);
  await db.execute(sql`UPDATE api_catalog.requests SET state='rejected',decision='目标项目已永久删除',decided_at=now() WHERE operation_id IN (${operations(context.target)}) AND project_id<>${context.target.id} AND state='pending'`);
}
export async function purge(db: Executor, context: ProjectDeletionContext) {
  await disable(db, context);
  await db.execute(sql`DELETE FROM api_catalog.allocation_receipts WHERE service_id IN (${services(context.target)})`);
  await db.execute(sql`DELETE FROM api_catalog.grants WHERE service_id IN (${services(context.target)})`);
  await db.execute(sql`DELETE FROM api_catalog.requests WHERE project_id=${context.target.id}`);
  await db.execute(sql`DELETE FROM api_catalog.operations WHERE id IN (${operations(context.target)})`);
  await db.execute(sql`DELETE FROM api_catalog.proxies WHERE project_id=${context.target.id}`);
}
