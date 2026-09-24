import type { ClusterManagementModuleApi } from '../api/moduleApi';
import { notFound } from '@crewstation/kernel';
import type { ClusterDeps } from './dependencies';
import { requireAdmin, readSnapshot, snapshotSummary, pageResources, resourceIn, relatedResources, completeSnapshot, projectResources } from './queries';
import { operationUseCases } from './operations';
import { overlayLedger } from './ledgerOverlay';
export function clusterApi(deps: ClusterDeps): ClusterManagementModuleApi {
  return {
    name: 'cluster-management', ...operationUseCases(deps),
    summary: async (actor, q) => { await requireAdmin(deps, actor); return snapshotSummary(await readSnapshot(deps, q.snapshotId), q); },
    // 清单、详情与项目盘点都以快照为底，台账认领的行叠加标准记录（RFC-025 T13，I29 裁定）。
    resources: async (actor, q) => { await requireAdmin(deps, actor); const page = pageResources(await readSnapshot(deps, q.snapshotId), q); return { ...page, items: await overlayLedger(deps, actor, page.items) }; },
    projectResources: async (actor, projectId, snapshotId) => { const view = await projectResources(deps, actor, projectId, snapshotId); return { ...view, items: await overlayLedger(deps, actor, view.items, true) }; },
    detail: async (actor, id, snapshotId) => {
      await requireAdmin(deps, actor);
      const s = await readSnapshot(deps, snapshotId), base = resourceIn(s, id), [resource, ...related] = await overlayLedger(deps, actor, [base, ...relatedResources(s, base)]);
      return { resource: resource!, related, complete: completeSnapshot(s), sources: s.sources };
    },
    events: async (actor, id) => { await requireAdmin(deps, actor); return deps.cluster.events(resourceIn(await readSnapshot(deps), id)); },
    logs: async (actor, id, q) => { await requireAdmin(deps, actor); return deps.cluster.logs(resourceIn(await readSnapshot(deps), id), q); },
    refresh: async (actor) => { await requireAdmin(deps, actor); return { refreshId: await deps.repository.requestRefresh() }; },
    operations: async (actor, q) => { await requireAdmin(deps, actor); return { items: await deps.repository.operations(q, actor.userId) }; },
    reconcile: async (actor, id) => { await requireAdmin(deps, actor); return deps.repository.reconcile(id, deps.clock.now()); },
    operation: async (actor, id) => { await requireAdmin(deps, actor); const op = await deps.repository.operation(id); if (!op) throw notFound('操作', id); return op; },
  };
}
