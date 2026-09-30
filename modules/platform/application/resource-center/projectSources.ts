import type { LegacyResourceRequest } from '@crewstation/contracts';
import { notFound } from '@crewstation/kernel';
import type { ProjectResourceDetailPorts, ProjectResourceSource } from '../../ports/projectResourceSources';
import { graphEdge, graphNode, projectResourceId } from '../../domain/projectResourceGraph';
import { ledgerResourceGraph } from './ledgerGraph';
import { executionResourceGraph } from './executionGraph';
import { dataResourceGraph } from './dataGraph';
import { serviceResourceGraph } from './serviceGraph';
import { configResourceGraph, namespaceResourceGraph } from './foundationGraph';

export function projectResourceSources(p: ProjectResourceDetailPorts) {
  const sources: ProjectResourceSource[] = [
    { id: 'ledger', name: '资源台账与实际对象', load: (actor, id) => ledgerResourceGraph(p, actor, id) },
    { id: 'executions', name: '工作区与执行', load: (actor, id) => executionResourceGraph(p, actor, id) },
    { id: 'data', name: '数据库、对象空间与数据绑定', load: (actor, id) => dataResourceGraph(p, actor, id) },
    { id: 'releases', name: '服务、发布与 Manifest', load: (actor, id) => serviceResourceGraph(p, actor, id) },
    { id: 'config', name: '配置与密钥元数据', load: (actor, id) => configResourceGraph(p, actor, id) },
    { id: 'quota-observation', name: '实际命名空间额度与占用', load: (actor, id) => namespaceResourceGraph(p, actor, id) },
    { id: 'repository', name: '源码仓库', load: async (actor, id) => { const service = await p.service(id); if (!service) throw notFound('服务'); const repo = await p.repository(actor, service.serviceId), node = graphNode(`repository:${service.serviceId}`, repo.pathWithNamespace, 'repository', 'service', { resourceId: service.serviceId, kind: 'component', state: repo.state, stateText: repo.state, ownerId: projectResourceId(id), facts: [{ label: '默认分支', value: repo.defaultBranch }, { label: '提供方', value: repo.provider }] }); return { nodes: [node], edges: [graphEdge(projectResourceId(id), node.id, 'owns', 'configured', '项目源码'), graphEdge(`service:${service.serviceId}`, node.id, 'uses', 'configured', '构建来源')] }; } },
    { id: 'integration', name: '事件、MCP 与观测入口', load: async (actor, id) => {
      const subscriptions = await p.subscriptions(actor, id), nodes = [], edges = [], root = projectResourceId(id), service = await p.service(id);
      for (const subscription of subscriptions) {
        const event = graphNode(`event:${id}:${subscription.eventTypeId}`, subscription.eventType, 'event-type', 'integration', { resourceId: subscription.eventTypeId, kind: 'component', ownerId: root, source: 'configuration' });
        const handler = graphNode(`subscription:${subscription.id}`, subscription.handlerPath, 'event-subscription', 'integration', { resourceId: subscription.id, kind: 'component', ownerId: root, source: 'configuration', state: subscription.state, stateText: subscription.state, facts: [{ label: '订阅入口', value: subscription.handlerPath }] });
        nodes.push(event, handler); edges.push(graphEdge(event.id, handler.id, 'pushes', 'configured', '事件订阅'));
        if (service) edges.push(graphEdge(handler.id, `service:${service.serviceId}`, 'pushes', 'configured', '已配置订阅'));
      }
      for (const endpoint of p.mcp) { const node = graphNode(`mcp:${id}:${endpoint.name}`, `MCP · ${endpoint.name}`, 'mcp', 'integration', { kind: 'component', ownerId: root, source: 'automatic', facts: [{ label: '访问', value: '项目服务与开发容器通过平台身份访问' }] }); nodes.push(node); if (service) edges.push(graphEdge(`service:${service.serviceId}`, node.id, 'calls', 'configured', '平台 MCP 能力')); }
      const observation = graphNode(`observability:${id}`, '日志、指标与调用链', 'observability', 'foundation', { kind: 'component', ownerId: root, facts: [{ label: '范围', value: '当前项目的实例与调用链' }] }); nodes.push(observation); edges.push(graphEdge(root, observation.id, 'owns', 'configured', '项目观测'));
      return { nodes, edges };
    } },
  ];
  return { sources, legacyRequests: async (actor: Parameters<typeof p.apiRequests>[0], id: Parameters<typeof p.apiRequests>[1]): Promise<LegacyResourceRequest[]> => {
    const [api, bindings] = await Promise.all([p.apiRequests(actor, id), p.bindings(actor, id)]);
    return [...api.filter((r) => r.state === 'pending').map((r) => ({ id: r.id, resourceType: 'api-operation' as const, targetResourceId: r.operationId, name: '已有 API 授权申请', state: r.state, reason: r.reason ?? '', requestedBy: r.requestedBy, requesterName: r.requestedByName ?? null, createdAt: r.createdAt, values: {}, canDecide: actor.isAdmin })), ...bindings.filter((b) => ['requested', 'approved'].includes(b.state) && b.mode !== 'development').map((b) => ({ id: b.id, resourceType: 'production-data' as const, targetResourceId: b.taskId, name: '已有生产数据访问申请', state: b.state, reason: b.reason ?? '', requestedBy: b.requestedBy, requesterName: b.requestedByName ?? null, createdAt: b.createdAt, values: { mode: b.mode, ttlMinutes: b.ttlMinutes ?? null }, canDecide: actor.isAdmin && b.state === 'requested' }))];
  } };
}
