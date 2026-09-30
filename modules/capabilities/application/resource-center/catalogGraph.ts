import type { ProjectId, ResourceTargetInspection } from '@crewstation/contracts';
import { allocationNodeId, projectNodeId, resourceEdge, resourceNode } from '../../domain/resource-center/graph';

export function resourceCatalogGraph(projectId: ProjectId, inspections: ResourceTargetInspection[]) {
  const nodes = inspections.map(({ view, actions, policy, requestable }) => {
    const id = view.owned ? allocationNodeId(projectId, view.target.resourceType, view.target.resourceId) : `catalog:${view.target.resourceType}:${view.target.resourceId}`;
    const category = ['namespace-quota', 'gateway-limit'].includes(view.target.resourceType) ? 'foundation' : view.target.resourceType === 'service-plan' ? 'service' : ['object-plan', 'object-space', 'production-data'].includes(view.target.resourceType) ? 'data' : view.target.resourceType === 'api-operation' ? 'integration' : 'execution';
    const policyAction = policy ? [{ id: `catalog-policy:${view.target.resourceType}:${view.target.resourceId}`, kind: 'catalog-policy' as const, label: '设置可申请范围', target: view.target, revision: String(policy.revision), current: { requestable: policy.requestable }, fields: [{ key: 'requestable', label: '允许项目负责人申请', type: 'boolean' as const, required: true }], impact: ['此目录政策影响所有项目的未授权资源可见性和申请资格', '已有授权与运行实例保持原状态'], enabled: true }] : [];
    return resourceNode(id, view.name, view.target.resourceType, category, { resourceId: view.target.resourceId, kind: view.owned ? 'allocation' : 'catalog', description: view.description ?? '', access: view.owned ? 'owned' : requestable ? 'requestable' : 'unavailable', source: view.source ?? 'granted', state: view.available ? 'available' : 'unavailable', stateText: view.owned ? '已授权' : '目录资源', facts: [...(view.facts ?? []), ...(policy ? [{ label: '申请目录', value: policy.requestable ? '明确开放申请' : '未开放申请' }] : [])], metrics: view.metrics ?? [], ownerId: projectNodeId(projectId), actions: [...actions, ...policyAction] });
  });
  return { nodes, edges: nodes.map((node) => resourceEdge(projectNodeId(projectId), node.id, node.access === 'owned' ? 'grants' : 'owns', node.access === 'owned' ? 'configured' : 'proposed', node.access === 'owned' ? '项目授权' : '可选目录')) };
}
