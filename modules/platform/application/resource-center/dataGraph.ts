import type { Actor, ProjectId } from '@crewstation/contracts';
import type { ProjectResourceDetailPorts } from '../../ports/projectResourceSources';
import { allocationId, graphEdge, graphNode, projectResourceId, recordId } from '../../domain/projectResourceGraph';
import { quotaMetric } from './catalog';

export async function dataResourceGraph(p: ProjectResourceDetailPorts, actor: Actor, projectId: ProjectId) {
  const [data, spaces, bindings, service] = await Promise.all([p.data(actor, projectId), p.spaces?.(actor, projectId) ?? [], p.bindings(actor, projectId), p.service(projectId)]);
  let complete = true;
  const slots = await (async () => {
    if (!service) return [];
    try { const [ledger, usages] = await Promise.all([p.ledger(actor, projectId), p.releaseUsage(actor, service.serviceId)]); return ledger.items.filter((r) => r.kind === 'service-slot' && usages.some((u) => u.physical === r.display?.physical)); }
    catch { complete = false; return []; }
  })();
  const edges = [], nodes = data.map((resource) => {
    const id = recordId(resource.id);
    if (resource.env === 'production' && service) edges.push(graphEdge(`service:${service.serviceId}`, id, 'uses', 'configured', '生产环境数据库'));
    if (resource.env === 'production') for (const slot of slots) edges.push(graphEdge(recordId(slot.id), id, 'uses', 'configured', '双槽共享生产数据库'));
    return graphNode(id, `${resource.env === 'production' ? '生产' : '开发'} PostgreSQL`, 'database', 'data', { resourceId: resource.id, environment: resource.env, source: 'automatic', state: resource.state, stateText: resource.state, ownerId: projectResourceId(projectId), facts: [{ label: '引擎', value: resource.kind }, { label: '套餐', value: resource.plan }, { label: '连接变量', value: resource.envVar }], metrics: [{ ...quotaMetric(`database:${resource.id}`, 'storage', '数据库容量', 'GiB', null), limitKind: 'shared' }] });
  });
  for (const space of spaces) {
    const id = allocationId(projectId, 'object-space', space.id);
    edges.push(graphEdge(allocationId(projectId, 'object-plan', space.planId), id, 'grants', 'configured', '采用套餐'), graphEdge(id, recordId(space.id), 'owns', 'observed', '空间实况'));
    if (space.env === 'production' && service) edges.push(graphEdge(`service:${service.serviceId}`, id, 'uses', 'configured', '生产对象存储'));
    if (space.env === 'production') for (const slot of slots) edges.push(graphEdge(recordId(slot.id), id, 'uses', 'configured', '双槽共享生产对象空间'));
    nodes.push(graphNode(id, `${space.env === 'production' ? '生产' : '开发'}对象空间`, 'object-space', 'data', { resourceId: space.id, kind: 'allocation', environment: space.env, state: space.health, stateText: space.health, source: 'configuration', ownerId: projectResourceId(projectId), facts: [{ label: '套餐版本', value: String(space.planRevision) }, { label: '待删除容量', value: `${space.deletingBytes / 1024 ** 3} GiB` }] }));
  }
  for (const binding of bindings) {
    const active = binding.state === 'active' && (!binding.expiresAt || Date.parse(binding.expiresAt) > Date.now()), database = data.find((d) => d.env === (binding.mode === 'development' ? 'development' : 'production') && d.kind === 'postgres');
    const id = recordId(binding.id);
    const state = active ? 'active' : binding.state === 'active' ? 'expired' : binding.state;
    nodes.push(graphNode(id, binding.mode === 'development' ? '开发数据访问' : '生产数据临时访问', 'data-binding', 'data', { resourceId: binding.id, environment: binding.mode === 'development' ? 'development' : 'production', source: 'granted', access: ['requested', 'approved'].includes(binding.state) ? 'pending' : 'owned', ownerId: recordId(binding.taskId), state, stateText: state, facts: [{ label: '工作区', value: binding.taskId }, { label: '访问模式', value: binding.mode }, { label: '到期', value: binding.expiresAt ?? '无到期时间 / 尚未批准' }] }));
    edges.push(graphEdge(recordId(binding.taskId), id, 'grants', active ? 'observed' : 'proposed', '数据访问绑定'));
    if (database && active) edges.push(graphEdge(id, recordId(database.id), 'uses', 'observed', binding.mode === 'diagnostic-readonly' ? '临时只读' : '访问数据'));
  }
  return { nodes, edges, complete, ...(!complete ? { message: '两槽归属暂不可读取，数据库与绑定详情已保留' } : {}) };
}
