import { ResourceIdSchema } from '@crewstation/contracts';
import type { ClusterResource } from '@crewstation/contracts';
import type { ClusterDeps } from './dependencies';

/** Kubernetes labels remain physical evidence; platform navigation uses canonical resource IDs. */
export async function resourceReferences(deps: Pick<ClusterDeps, 'resolveReleaseId'>, rows: ClusterResource[]): Promise<ClusterResource[]> {
  return Promise.all(rows.map(async (row) => {
    if (!row.releaseId || ResourceIdSchema.safeParse(row.releaseId).success) return row;
    const id = await deps.resolveReleaseId?.(row.releaseId);
    if (id) return { ...row, releaseId: ResourceIdSchema.parse(id) };
    const { releaseId: _legacy, ...rest } = row;
    return { ...rest, facts: { ...row.facts, identityReason: '发布记录已不可用，保留原 Kubernetes 标签' } };
  }));
}
