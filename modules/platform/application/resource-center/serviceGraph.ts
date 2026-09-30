import type { Actor, ProjectId } from '@crewstation/contracts';
import { notFound } from '@crewstation/kernel';
import type { ProjectResourceDetailPorts } from '../../ports/projectResourceSources';
import { allocationId, graphEdge, graphNode, projectResourceId, recordId } from '../../domain/projectResourceGraph';
import { imageReferenceGraph } from './imageReferences';

export async function serviceResourceGraph(p: ProjectResourceDetailPorts, actor: Actor, projectId: ProjectId) {
  const service = await p.service(projectId); if (!service) throw notFound('项目服务');
  const [releases, slots, usages, ledger] = await Promise.all([p.releases(actor, service.serviceId), p.slots(actor, service.serviceId), p.releaseUsage(actor, service.serviceId), p.ledger(actor, projectId)]);
  const edges = [], serviceNode = graphNode(`service:${service.serviceId}`, service.name, 'service', 'service', { resourceId: service.serviceId, kind: 'component', ownerId: projectResourceId(projectId), facts: [{ label: '服务身份', value: service.identity }] });
  const nodes = [serviceNode]; edges.push(graphEdge(projectResourceId(projectId), serviceNode.id, 'owns', 'configured', '项目服务'));
  for (const release of releases) {
    const id = `release:${release.id}`; nodes.push(graphNode(id, release.tag, 'release', 'service', { resourceId: release.id, ownerId: serviceNode.id, state: release.status, stateText: release.status, observedAt: release.updatedAt, facts: [{ label: '固定提交', value: release.commitSha }, { label: '分支', value: release.branch }, ...(release.image ? [{ label: '发布镜像', value: release.image }] : [])] }));
    edges.push(graphEdge(serviceNode.id, id, 'owns', 'configured', '发布产物'));
    for (const job of ledger.items.filter((r) => ['build-job', 'migration-job'].includes(r.kind) && r.display?.releaseId === release.id)) edges.push(graphEdge(id, recordId(job.id), 'owns', 'configured', '发布流水线'));
  }
  for (const usage of usages) {
    const releaseId = `release:${usage.releaseId}`, slot = slots.find((s) => s.releaseId === usage.releaseId), record = ledger.items.find((r) => r.kind === 'service-slot' && r.display?.physical === usage.physical);
    if (!nodes.some((n) => n.id === releaseId)) nodes.push(graphNode(releaseId, slot?.tag ?? usage.releaseId.slice(0, 8), 'release', 'service', { resourceId: usage.releaseId, ownerId: serviceNode.id }));
    if (record) edges.push(graphEdge(recordId(record.id), releaseId, 'uses', 'configured', `${usage.role === 'prod' ? '正式' : '待命'}槽采用`));
    if (usage.servicePlanId) edges.push(graphEdge(releaseId, allocationId(projectId, 'service-plan', usage.servicePlanId), 'uses', 'configured', 'Manifest 服务规格'));
    if (usage.taskProfileId) edges.push(graphEdge(releaseId, allocationId(projectId, 'task-profile', usage.taskProfileId), 'uses', 'configured', '业务任务规格'));
    for (const id of usage.computeProfileIds) edges.push(graphEdge(releaseId, allocationId(projectId, 'compute-profile', id), 'uses', 'configured', 'Manifest Agent 档位'));
    for (const id of usage.configDefinitionIds) edges.push(graphEdge(releaseId, `config:${projectId}:production:${id}`, 'uses', 'configured', '生产配置引用'));
    for (const id of usage.requestedApiIds) edges.push(graphEdge(releaseId, allocationId(projectId, 'api-operation', id), 'calls', 'configured', '声明调用 API'));
    for (const id of usage.eventTypeIds) edges.push(graphEdge(`event:${projectId}:${id}`, releaseId, 'pushes', 'configured', '事件订阅'));
    if (usage.objectPlanId) edges.push(graphEdge(releaseId, allocationId(projectId, 'object-plan', usage.objectPlanId), 'uses', 'configured', 'Manifest 对象套餐'));
  }
  const images = await imageReferenceGraph(p, projectId, usages.flatMap((u) => u.runtimeImageVersionIds.map((versionId) => ({ ownerId: `release:${u.releaseId}`, versionId, label: 'Manifest 镜像' }))));
  return { nodes: [...nodes, ...images.nodes], edges: [...edges, ...images.edges], complete: releases.length < 50 && images.complete !== false, ...(releases.length >= 50 ? { message: '包含当前两槽与最近 50 次发布；完整发布历史在发布页' } : images.message ? { message: images.message } : {}) };
}
