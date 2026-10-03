import { ProjectIdSchema, ResourceIdSchema } from '@crewstation/contracts';
import { jsonHash, precondition } from '@crewstation/kernel';
import type { Database } from '@crewstation/persistence';
import { sql } from 'drizzle-orm';

type Kind = 'cluster-refresh' | 'cluster-operation' | 'cluster-metrics' | 'cluster-storage';
export async function clusterInfrastructureOrigin(db: Database, kind: Kind, key: string, representation: 'current' | 'legacy' = 'current') {
  if (!['cluster-refresh', 'cluster-operation', 'cluster-metrics', 'cluster-storage'].includes(kind) || !['current', 'legacy'].includes(representation)) throw precondition('集群原来源类型未登记');
  if (representation === 'current') ResourceIdSchema.parse(key);
  return db.transaction(async (tx) => {
    await tx.execute(sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`);
    const alias = (await tx.execute<{ id: string }>(sql`SELECT id FROM cluster_management.resource_identity_aliases WHERE kind=${kind} AND key=${JSON.stringify([key])}`))[0]?.id;
    const canonical = ResourceIdSchema.safeParse(key).success ? key : undefined;
    if (alias && canonical && alias !== canonical) throw precondition('集群原标识目录冲突');
    if (!alias && !canonical) return undefined;
    const id = ResourceIdSchema.parse(alias ?? canonical);
    const row = (await tx.execute<{ material: { scope?: string; projectId?: string; component?: string; resourceId?: string; resourceUid?: string } }>(sql`SELECT material
      FROM cluster_management.infrastructure_origins WHERE kind=${kind} AND id=${id}`))[0];
    if (!row || row.material.scope === 'unknown') return undefined;
    const material = row.material;
    if (kind === 'cluster-operation') {
      ResourceIdSchema.parse(material.resourceId);
      if (!material.resourceUid) throw precondition('集群操作原资源身份不完整');
      const active = (await tx.execute<{ material: unknown }>(sql`SELECT cluster_management.operation_origin(body) AS material FROM cluster_management.operations WHERE id=${id}`))[0];
      if (active && jsonHash(active.material) !== jsonHash(material)) throw precondition('集群操作原项目归属冲突');
    }
    if (material.scope === 'platform') {
      if (material.projectId || kind === 'cluster-operation' && !material.component) throw precondition('集群平台原范围冲突');
      return { complete: true as const, id, scope: 'platform' as const, projectIds: [] as const, revision: jsonHash({ kind, id, material }) };
    }
    if (material.scope !== 'project' || kind !== 'cluster-operation') throw precondition('集群原来源范围未登记');
    const projectId = ProjectIdSchema.parse(material.projectId);
    return { complete: true as const, id, scope: 'project' as const, projectIds: [projectId], revision: jsonHash({ kind, id, material }) };
  });
}
