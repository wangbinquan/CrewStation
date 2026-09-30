import type { Actor, ProjectId, ProjectResourceNode } from '@crewstation/contracts';
import type { ProjectResourceDetailPorts } from '../../ports/projectResourceSources';
import { allocationId, graphEdge, graphNode, projectResourceId, resourceQuantity } from '../../domain/projectResourceGraph';
import { quotaMetric } from './catalog';

export async function configResourceGraph(p: ProjectResourceDetailPorts, actor: Actor, projectId: ProjectId) {
  const nodes: ProjectResourceNode[] = [], edges = []; let complete = true;
  for (const env of ['development', 'production'] as const) {
    const values = await p.config(actor, projectId, env); if (values.length > 500) complete = false;
    for (const item of values.slice(0, 500)) { const id = `config:${projectId}:${env}:${item.definitionId}`; nodes.push(graphNode(id, item.name, item.isSecret ? 'secret' : 'configuration', 'foundation', { resourceId: item.id, kind: 'component', environment: env, ownerId: projectResourceId(projectId), source: 'configuration', observedAt: item.updatedAt, facts: [{ label: '变量名', value: item.bindingName }, { label: '类型', value: item.isSecret ? '密钥，仅显示元数据' : '普通配置' }, { label: '版本', value: String(item.version) }] })); edges.push(graphEdge(projectResourceId(projectId), id, 'owns', 'configured', `${env} 配置`)); }
  }
  return { nodes, edges, complete, ...(!complete ? { message: '每个环境首屏最多 500 项配置，完整配置在配置页' } : {}) };
}
export async function namespaceResourceGraph(p: ProjectResourceDetailPorts, _actor: Actor, projectId: ProjectId) {
  const object = await p.quota(projectId), id = allocationId(projectId, 'namespace-quota', projectId), at = new Date().toISOString();
  const dimensions = [{ key: 'requestsCpu', hard: 'requests.cpu', label: 'CPU 请求总量', unit: '核', quantity: 'cpu' as const }, { key: 'requestsMemoryGiB', hard: 'requests.memory', label: '内存请求总量', unit: 'GiB', quantity: 'GiB' as const }, { key: 'pods', hard: 'pods', label: 'Pod 总数', unit: '个', quantity: 'count' as const }, { key: 'persistentVolumeClaims', hard: 'persistentvolumeclaims', label: 'PVC 总数', unit: '个', quantity: 'count' as const }];
  return { nodes: [graphNode(id, '命名空间资源额度', 'namespace-quota', 'foundation', { resourceId: projectId, kind: 'allocation', source: 'observed', ownerId: projectResourceId(projectId), state: object ? 'observed' : 'pending', stateText: object ? '实际额度已读取' : '尚未供给', observedAt: object ? at : null, metrics: dimensions.map((d) => ({ ...quotaMetric(`namespace:${projectId}`, d.key, d.label, d.unit, resourceQuantity(object?.status?.hard?.[d.hard], d.quantity), resourceQuantity(object?.status?.used?.[d.hard], d.quantity)), observedAt: object ? at : null })) })], edges: [] };
}
