import type { ResourceTargetDescription } from '@crewstation/contracts';
import { notFound } from '@crewstation/kernel';
import type { ResourceCatalogPorts } from '../../ports/resourceCatalogs';
import { actions, catalogAdapter, quotaMetric, resourceCommand } from './catalog';

export function integrationResourceCatalogs(p: ResourceCatalogPorts) {
  const service = async (id: Parameters<typeof p.project.resolveServiceOfProject>[0]) => { const value = await p.project.resolveServiceOfProject(id); if (!value) throw notFound('项目服务'); return value; };
  const api = catalogAdapter('api-operation', async (id) => {
    const [operations, requests] = await Promise.all([p.api.listOperations(p.actor, (await service(id)).serviceId), p.api.listRequests(p.actor, id)]);
    const pending = new Set(requests.filter((r) => r.state === 'pending').map((r) => r.operationId));
    return operations.flatMap((operation) => actions({ target: { resourceType: 'api-operation', resourceId: operation.id, action: 'grant' }, name: `${operation.method} ${operation.path}`, description: operation.summary, revision: p.revisions.api(operation, operation.granted ?? false), current: {}, fields: [], impact: ['授予该服务调用操作的权限，网关放行表同步后生效', '不会修改该接口的全局开放范围'], owned: operation.granted ?? operation.openPolicy === 'default', available: operation.openPolicy !== 'default' && !pending.has(operation.id), ...(operation.openPolicy === 'default' ? { reason: '平台默认开放能力；项目无需单独申请或撤销' } : pending.has(operation.id) ? { reason: '已有待审批的 API 申请，请先处理原申请' } : {}), source: operation.openPolicy === 'default' ? 'inherited' : 'granted', facts: [{ label: '授权范围', value: operation.openPolicy === 'default' ? '平台默认开放' : '定向授权' }, { label: '接口', value: `${operation.method} ${operation.path}` }] }, operation.openPolicy !== 'default'));
  }, async (c) => p.api.applyResourceChange(c.actor, (await service(c.projectId)).serviceId, resourceCommand(c)), async (id, operationId) => p.api.resourceChangeReceipt((await service(id)).serviceId, operationId), (id, target) => p.observeApi(id, target));
  const gateway = catalogAdapter('gateway-limit', async (id) => {
    const [value, platform] = await Promise.all([p.gateway.getProjectRateLimits(p.actor, id), p.gateway.getRateLimits(p.actor)]), current = p.revisions.gatewayValues(value.effective);
    const labels: Record<string, string> = { userAverage: '单用户平均', userBurst: '单用户突发', hostAverage: '用户域主机平均', hostBurst: '用户域主机突发', sourceAverage: '来源服务平均', sourceBurst: '来源服务突发', targetAverage: '目标服务平均', targetBurst: '目标服务突发' };
    const view: ResourceTargetDescription = { target: { resourceType: 'gateway-limit', resourceId: id, action: 'set-quota' }, name: '网关请求限流', revision: p.revisions.gateway(value, platform.revision), current, fields: Object.keys(current).map((key) => ({ key, label: labels[key]!, type: 'number', min: 1, max: key.endsWith('Burst') ? 200000 : 100000, integer: true, unit: key.endsWith('Burst') ? '次' : '次/秒', required: true })), impact: ['突发额度须不小于对应平均额度', '保存项目覆盖策略，由网关中间件实际同步后生效'], owned: true, available: true, source: value.override ? 'configuration' : 'inherited', metrics: Object.entries(current).map(([key, limit]) => quotaMetric(`gateway:${id}`, key, labels[key]!, key.endsWith('Burst') ? '次' : '次/秒', Number(limit))) };
    return [view, ...(value.override ? [{ ...view, target: { ...view.target, action: 'set-default' as const }, current: {}, fields: [], impact: ['删除项目覆盖，持续继承平台默认限流；仍须等待中间件同步'] }] : [])];
  }, (c) => p.gateway.applyResourceChange(c.actor, c.projectId, resourceCommand(c)), p.gateway.resourceChangeReceipt, (id, _target, receipt) => p.observeGateway(id, receipt));
  return [api, gateway];
}
