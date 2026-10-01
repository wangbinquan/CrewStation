import type { ProjectDeletionContext, ProjectId } from '@crewstation/contracts';
import { precondition } from '@crewstation/kernel';
import type { Database } from '@crewstation/persistence';
import { sql } from 'drizzle-orm';
import type { ApiCatalogDeletionRepository } from '../../../ports/deletion';
import { inspect, registered } from './inspection';
import { assertSealed, lock, seedServiceIdentities } from './fence';
import { disable, purge } from './content';

export async function originalOperationProject(db: Database, id: string): Promise<ProjectId | undefined> {
  const rows = await db.execute<{ project_id: ProjectId }>(sql`SELECT DISTINCT project_id FROM api_catalog.deletion_entities WHERE kind='operation'
    AND (entity_id=${id} OR entity_id IN (SELECT id FROM api_catalog.resource_identity_aliases WHERE kind='api-operation' AND key=${JSON.stringify([id])}))`);
  if (rows.length > 1) throw precondition('原 API 操作别名的项目归属不唯一');
  return rows[0]?.project_id;
}

export function apiCatalogDeletionRepository(db: Database, assertGrant: (context: ProjectDeletionContext) => Promise<void>): ApiCatalogDeletionRepository {
  return {
    inspect: (target) => inspect(db, target),
    seal: (context) => db.transaction(async (tx) => {
      const row = await lock(tx, context); await assertGrant(context); await registered(tx);
      const renewed = Boolean(row.operation_id && !row.scope_verified && row.generation < context.generation && row.confirmed_revision !== context.confirmed.revision);
      if (row.operation_id && row.confirmed_revision !== context.confirmed.revision && !renewed) throw precondition('API 目录确认摘要不能被替换');
      if (row.operation_id && !renewed) { if (!row.scope_verified) return false; await assertSealed(tx, context); return true; }
      await seedServiceIdentities(tx, context); const current = await inspect(tx, context.target);
      await tx.execute(sql`UPDATE api_catalog.deletion_fences SET operation_id=${context.operationId},generation=${context.generation},confirmed_revision=${context.confirmed.revision},scope_verified=${current.revision === context.confirmed.revision} WHERE project_id=${context.target.id}`);
      await disable(tx, context); return current.revision === context.confirmed.revision;
    }),
    assertSealed: (context) => db.transaction(async (tx) => { await assertGrant(context); await assertSealed(tx, context); }),
    purge: (context) => db.transaction(async (tx) => {
      await assertGrant(context); await assertSealed(tx, context); await registered(tx); await purge(tx, context);
      if ((await inspect(tx, context.target)).resources.some((r) => r.count !== 0)) throw precondition('API 目录清理没有归零');
    }),
  };
}
