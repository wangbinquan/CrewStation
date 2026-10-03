import { ProjectIdSchema, ResourceIdSchema, ServiceIdSchema } from '@crewstation/contracts';
import { jsonHash, precondition } from '@crewstation/kernel';
import type { Database } from '@crewstation/persistence';
import { sql } from 'drizzle-orm';

/** Reads only this owner's original IDs. Release names, manifests, credentials and tags never leave the source. */
export async function releaseInfrastructureOrigin(db: Database, key: string, representation: 'current' | 'legacy' = 'current') {
  if (representation !== 'current' && representation !== 'legacy') throw precondition('发布原表示类型未登记');
  if (representation === 'current') ResourceIdSchema.parse(key);
  return db.transaction(async (tx) => {
    await tx.execute(sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`);
    const alias = (await tx.execute<{ id: string }>(sql`SELECT id FROM release.resource_identity_aliases WHERE kind='release' AND key=${JSON.stringify([key])}`))[0]?.id;
    const canonical = ResourceIdSchema.safeParse(key).success ? key : undefined;
    if (alias && canonical && alias !== canonical) throw precondition('发布原标识目录冲突');
    if (!alias && !canonical) return undefined;
    const id = ResourceIdSchema.parse(alias ?? canonical);
    const active = (await tx.execute<{ project_id: string; service_id: string }>(sql`SELECT project_id,service_id FROM release.releases WHERE id=${id}`))[0];
    const retained = await tx.execute<{ project_id: string }>(sql`SELECT DISTINCT project_id FROM release.deletion_entities
      WHERE kind='release' AND (entity_key=${id} OR entity_key=${key}) ORDER BY project_id`);
    const projects = new Set(retained.map((row) => ProjectIdSchema.parse(row.project_id)));
    if (active) { projects.add(ProjectIdSchema.parse(active.project_id)); ServiceIdSchema.parse(active.service_id); }
    if (!projects.size) return undefined;
    if (projects.size !== 1) throw precondition('发布原项目归属冲突');
    const projectId = [...projects][0]!;
    return { complete: true as const, id, scope: 'project' as const, projectIds: [projectId], revision: jsonHash({ kind: 'release', id, projectId }) };
  });
}
