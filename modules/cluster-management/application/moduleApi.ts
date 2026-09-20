import type { ClusterManagementModuleApi } from '../api/moduleApi';
import { notFound } from '@crewstation/kernel';
import type { ClusterDeps } from './dependencies';
import { requireAdmin, readSnapshot, snapshotSummary, pageResources, resourceIn, relatedResources, completeSnapshot } from './queries';
import { operationUseCases } from './operations';
export function clusterApi(deps: ClusterDeps): ClusterManagementModuleApi {
  return {
    name: 'cluster-management', ...operationUseCases(deps),
    summary: async (actor, q) => { await requireAdmin(deps, actor); return snapshotSummary(await readSnapshot(deps, q.snapshotId), q); },
    resources: async (actor, q) => { await requireAdmin(deps, actor); return pageResources(await readSnapshot(deps, q.snapshotId), q); },
    detail: async (actor, id, snapshotId) => { await requireAdmin(deps, actor); const s = await readSnapshot(deps, snapshotId), resource = resourceIn(s, id); return { resource, related: relatedResources(s, resource), complete: completeSnapshot(s), sources: s.sources }; },
    events: async (actor, id) => { await requireAdmin(deps, actor); return deps.cluster.events(resourceIn(await readSnapshot(deps), id)); },
    logs: async (actor, id, q) => { await requireAdmin(deps, actor); return deps.cluster.logs(resourceIn(await readSnapshot(deps), id), q); },
    refresh: async (actor) => { await requireAdmin(deps, actor); return { refreshId: await deps.repository.requestRefresh() }; },
    operations: async (actor, q) => { await requireAdmin(deps, actor); return { items: await deps.repository.operations(q, actor.userId) }; },
    reconcile: async (actor, id) => { await requireAdmin(deps, actor); return deps.repository.reconcile(id, deps.clock.now()); },
    operation: async (actor, id) => { await requireAdmin(deps, actor); const op = await deps.repository.operation(id); if (!op) throw notFound('操作', id); return op; },
  };
}
