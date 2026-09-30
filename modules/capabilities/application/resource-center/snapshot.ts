import type { Actor, ProjectId, ProjectResourceSnapshot, ResourceSourceStatus } from '@crewstation/contracts';
import { ResourceTypeSchema } from '@crewstation/contracts';
import type { Clock } from '@crewstation/kernel';
import { forbidden } from '@crewstation/kernel';
import type { ResourceCenterSources, ProjectResourceFragment } from '../../ports/resourceCenter';
import { allocationNodeId, mergeResourceGraph, projectNodeId, resourceEdge, resourceNode } from '../../domain/resource-center/graph';
import { resourceCatalogGraph } from './catalogGraph';

export function projectResourceSnapshot(sources: ResourceCenterSources, clock: Clock) {
  return async (actor: Actor, projectId: ProjectId): Promise<ProjectResourceSnapshot> => {
    const role = await sources.authorize(actor, projectId, 'view');
    if (!['owner', 'developer', 'admin'].includes(role)) throw forbidden('需要项目资源查看权限');
    const project = await sources.project(actor, projectId), at = clock.now().toISOString();
    const statuses: ResourceSourceStatus[] = [], fragments: ProjectResourceFragment[] = [];
    const read = async <T>(id: string, name: string, load: () => Promise<T>): Promise<T | undefined> => {
      try { const value = await load(); statuses.push({ id, name, observedAt: at, complete: true, error: null }); return value; }
      catch (error) { statuses.push({ id, name, observedAt: null, complete: false, error: error instanceof Error ? error.message : '来源暂不可用' }); return undefined; }
    };
    // Four readers at a time keep a large project from monopolizing the database pool.
    const loaders = [ ...ResourceTypeSchema.options.map((type) => async () => { const views = await read(`catalog:${type}`, type, () => sources.targets(actor, projectId, type)); if (views) fragments.push(resourceCatalogGraph(projectId, views)); }), ...sources.sources.map((source) => async () => { const fragment = await read(source.id, source.name, () => source.load(actor, projectId)); if (fragment) { fragments.push(fragment); if (fragment.complete === false) { const status = statuses.find((s) => s.id === source.id)!; status.complete = false; status.error = fragment.message ?? '来源只读取了部分记录'; } } }) ];
    for (let offset = 0; offset < loaders.length; offset += 4) await Promise.all(loaders.slice(offset, offset + 4).map((load) => load()));
    const [page, active, legacy] = await Promise.all([read('requests', '资源申请', () => sources.requests(actor, projectId)), read('active-requests', '未完成资源变更', () => sources.activeRequests(actor, projectId)), read('legacy-requests', '已有申请', () => sources.legacyRequests(actor, projectId))]);
    if (active?.nextCursor) { const status = statuses.find((s) => s.id === 'active-requests')!; status.complete = false; status.error = '未完成变更超过首屏上限，请在申请记录继续分页'; }
    const root = resourceNode(projectNodeId(projectId), project.name, 'project', 'foundation', { resourceId: projectId, kind: 'project', state: project.state, stateText: project.state, facts: [{ label: '命名空间', value: project.namespace }, { label: '项目类型', value: project.kind }] });
    const initialGraph = mergeResourceGraph([root, ...fragments.flatMap((f) => f.nodes)], fragments.flatMap((f) => f.edges));
    const nodes = initialGraph.nodes, edges = initialGraph.edges;
    const requests = [...new Map([...(page?.items ?? []), ...(active?.items ?? [])].map((r) => [r.id, r])).values()].sort((a, b) => b.id.localeCompare(a.id));
    for (const request of requests) {
      if (!['pending', 'approved', 'applying', 'needs-review', 'apply-failed'].includes(request.state)) continue;
      let target = nodes.find((n) => n.resourceType === request.target.resourceType && n.resourceId === request.target.resourceId);
      if (!target) { target = resourceNode(allocationNodeId(projectId, request.target.resourceType, request.target.resourceId), request.targetName, request.target.resourceType, 'foundation', { resourceId: request.target.resourceId, kind: 'allocation', access: 'pending', source: 'request', state: 'unavailable', stateText: '原申请目标已不可读取，请核对或撤回', ownerId: root.id }); nodes.push(target); }
      target.pendingRequestIds.push(request.id); if (target.access !== 'owned') target.access = 'pending';
      target.metrics = target.metrics.map((metric) => { const value = request.approvedValues?.[metric.key] ?? request.requestedValues[metric.key]; return typeof value === 'number' ? { ...metric, requestedLimit: value } : metric; });
      target.actions = target.actions.map((a) => a.kind === 'request' || a.kind === 'direct' ? { ...a, enabled: false, reason: '此资源已有未完成变更，请处理原申请' } : a);
      nodes.push(resourceNode(`request:${request.id}`, request.targetName, 'request', target.category, { resourceId: request.id, kind: 'request', access: 'pending', source: 'request', state: request.state, stateText: request.state, ownerId: root.id, facts: [{ label: '发起人', value: request.requesterName ?? request.requestedBy }, { label: '申请理由', value: request.reason }], observedAt: request.updatedAt }));
      edges.push(resourceEdge(`request:${request.id}`, target.id, 'changes', 'proposed', '申请变更'));
    }
    for (const request of legacy ?? []) {
      let target = nodes.find((n) => n.resourceType === request.resourceType && n.resourceId === request.targetResourceId);
      if (!target) { target = resourceNode(allocationNodeId(projectId, request.resourceType, request.targetResourceId), request.name, request.resourceType, request.resourceType === 'api-operation' ? 'integration' : 'data', { resourceId: request.targetResourceId, kind: 'allocation', access: 'pending', source: 'request', ownerId: root.id }); nodes.push(target); }
      target.pendingRequestIds.push(request.id); if (target.access !== 'owned') target.access = 'pending';
      target.actions = target.actions.map((a) => a.kind === 'request' || a.kind === 'direct' ? { ...a, enabled: false, reason: '已有未完成申请，请处理原申请' } : a);
      nodes.push(resourceNode(`legacy-request:${request.id}`, request.name, 'request', target.category, { resourceId: request.id, kind: 'request', access: 'pending', source: 'request', state: request.state, stateText: request.state, ownerId: root.id, observedAt: request.createdAt }));
      edges.push(resourceEdge(`legacy-request:${request.id}`, target.id, 'changes', 'proposed', '已有申请'));
    }
    const graph = mergeResourceGraph(nodes, edges);
    return { projectId, projectName: project.name, namespace: project.namespace, observedAt: at, role: role as ProjectResourceSnapshot['role'], archived: project.state === 'archived', complete: statuses.every((s) => s.complete), ...graph, sources: statuses.sort((a, b) => a.id.localeCompare(b.id)), requests, requestsNextCursor: page?.nextCursor ?? null, legacyRequests: legacy ?? [] };
  };
}
