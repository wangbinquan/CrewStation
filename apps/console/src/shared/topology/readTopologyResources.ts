import type { ClusterFilter, ClusterPage, ClusterResource } from '@crewstation/contracts';
import { api } from '../api/client';

/** Keep every page on the same snapshot; a bounded read must advertise truncation. */
export async function readTopologyResources(query: Pick<ClusterFilter, 'scope' | 'projectId' | 'snapshotId'>, read: (query: ClusterFilter) => Promise<ClusterPage> = (q) => api.cluster.resources(q)) {
  const items: ClusterResource[] = []; let cursor: string | undefined, complete = true, snapshotId = query.snapshotId;
  for (let page = 0; page < 20; page += 1) {
    const result = await read({ ...query, snapshotId, limit: 100, cursor });
    items.push(...result.items); complete = complete && result.complete; snapshotId = result.snapshotId;
    if (!result.nextCursor) return { items, complete, snapshotId, truncated: false };
    cursor = result.nextCursor;
  }
  return { items, complete: false, snapshotId, truncated: true };
}
