import type { ProjectDeletionContext, ProjectId } from '@crewstation/contracts';
import { ProjectIdSchema, ResourceIdSchema } from '@crewstation/contracts';
import { jsonHash, precondition } from '@crewstation/kernel';
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

/** Current and legacy forms must resolve to the same original canonical operation, including after catalog purge. */
export async function operationInfrastructureOrigin(db: Database, key: string, representation: 'current' | 'legacy' = 'current') {
  if (representation !== 'current' && representation !== 'legacy') throw precondition('API 操作原表示类型未登记');
  if (representation === 'current') ResourceIdSchema.parse(key);
  return db.transaction(async (tx) => {
    await tx.execute(sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`);
    const alias = (await tx.execute<{ id: string }>(sql`SELECT id FROM api_catalog.resource_identity_aliases WHERE kind='api-operation' AND key=${JSON.stringify([key])}`))[0]?.id;
    const canonical = ResourceIdSchema.safeParse(key).success ? key : undefined;
    if (alias && canonical && alias !== canonical) throw precondition('API 操作原标识目录冲突');
    if (!alias && !canonical) return undefined;
    const id = ResourceIdSchema.parse(alias ?? canonical);
    const rows = await tx.execute<{ project_id: string; active: boolean; active_project: string | null }>(sql`
      SELECT original.project_id,EXISTS(SELECT 1 FROM api_catalog.operations WHERE id=${id}) AS active,
        (SELECT p.project_id FROM api_catalog.operations o JOIN api_catalog.proxies p ON p.id=o.proxy_id WHERE o.id=${id}) AS active_project
      FROM api_catalog.deletion_entities original WHERE original.kind='operation' AND original.entity_id=${id}`);
    if (!rows.length) return undefined;
    const row = rows[0]!, projectId = ProjectIdSchema.parse(row.project_id);
    if (row.active && ProjectIdSchema.parse(row.active_project) !== projectId) throw precondition('API 操作原项目关系冲突');
    return { complete: true as const, id, scope: 'project' as const, projectIds: [projectId], revision: jsonHash({ kind: 'api-operation', id, projectId }) };
  });
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
