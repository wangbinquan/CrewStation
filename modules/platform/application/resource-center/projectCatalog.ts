import type { ResourceTargetDescription } from '@crewstation/contracts';
import type { ResourceCatalogPorts } from '../../ports/resourceCatalogs';
import { actions, catalogAdapter, confirming, quotaMetric, resourceCommand } from './catalog';

export function projectResourceCatalogs(p: ResourceCatalogPorts) {
  const service = catalogAdapter('service-plan', async (id) => {
    const [plans, policy] = await Promise.all([p.project.listServicePlans(), p.project.getServicePolicy(p.actor, id)]);
    return plans.flatMap((plan) => {
      const owned = (policy.policy.mode === 'inherit' || policy.policy.allowedPlanIds.includes(plan.id) || policy.policy.additionalPlanIds?.includes(plan.id)) && !policy.policy.excludedPlanIds?.includes(plan.id);
      return actions({ target: { resourceType: 'service-plan', resourceId: plan.id, action: 'grant' }, name: plan.name, description: plan.description, revision: p.revisions.service(policy.revision, plan), current: {}, fields: [], owned: Boolean(owned), available: true,
        source: policy.policy.additionalPlanIds?.includes(plan.id) || policy.policy.mode === 'restricted' ? 'granted' : 'inherited',
        facts: [{ label: 'CPU 请求 / 实例', value: plan.cpu }, { label: '内存请求 / 实例', value: plan.memory }], metrics: [quotaMetric(`service-template:${plan.id}`, 'replicas', '副本上限', '个', plan.maxReplicas)], impact: ['调整可选服务规格范围，下一次发布按 Manifest 选择规格', '共享规格模板不会被修改'] });
    });
  }, (c) => p.project.applyResourceChange(c.actor, c.projectId, resourceCommand(c)), p.project.resourceChangeReceipt);
  const execution = catalogAdapter('execution-quota', async (id) => { const quota = await p.project.getQuota(p.actor, id); return [{ target: { resourceType: 'execution-quota', resourceId: id, action: 'set-quota' }, name: '执行并发额度', revision: p.revisions.execution(quota.maxConcurrentTasks), current: { maxConcurrentTasks: quota.maxConcurrentTasks }, fields: [{ key: 'maxConcurrentTasks', label: '最大并发执行', type: 'number', min: 1, max: 100, integer: true, required: true, unit: '个' }], impact: ['工作区、任务执行与归档助手共用此额度', '降低额度不会结束已有任务；超额时阻止新增'], owned: true, available: true, source: 'configuration', metrics: [quotaMetric(`execution:${id}`, 'maxConcurrentTasks', '并发执行', '个', quota.maxConcurrentTasks, quota.running)] }]; }, (c) => p.project.applyResourceChange(c.actor, c.projectId, resourceCommand(c)), p.project.resourceChangeReceipt);
  const namespace = catalogAdapter('namespace-quota', async (id) => {
    const value = await p.project.getNamespaceQuota(p.actor, id), q = value.quota;
    const fields: ResourceTargetDescription['fields'] = [{ key: 'requestsCpu', label: 'CPU 请求总量', type: 'number', min: 0.1, max: 100000, unit: '核', required: true }, { key: 'requestsMemoryGiB', label: '内存请求总量', type: 'number', min: 0.125, max: 1000000, unit: 'GiB', required: true }, { key: 'pods', label: 'Pod 总数', type: 'number', min: 1, max: 100000, integer: true, unit: '个', required: true }, { key: 'persistentVolumeClaims', label: 'PVC 总数', type: 'number', min: 0, max: 100000, integer: true, unit: '个', required: true }];
    return [{ target: { resourceType: 'namespace-quota', resourceId: id, action: 'set-quota' }, name: '命名空间资源额度', revision: p.revisions.namespace(value.revision, q), current: { ...q }, fields, impact: ['保存项目额度政策，由集群调和器持续同步', '实际 ResourceQuota 同步后才显示已生效；不主动缩容或终止实例'], owned: true, available: true, source: value.revision ? 'configuration' : 'automatic', metrics: fields.map((f) => quotaMetric(`namespace:${id}`, f.key, f.label, f.unit!, q[f.key as keyof typeof q])) }];
  }, async (c) => { const receipt = await p.project.applyResourceChange(c.actor, c.projectId, resourceCommand(c)); await p.reapplyNamespace(c.projectId); return receipt; }, confirming(p.project.resourceChangeReceipt, p.reapplyNamespace), (id, _target, receipt) => p.observeNamespace(id, receipt));
  return [service, execution, namespace];
}
