import type { Actor, ProjectId, ResourceTarget, ResourceValues } from '@crewstation/contracts';
import { NamespaceQuotaSchema, ResourceIdSchema, SetQuotaRequestSchema } from '@crewstation/contracts';
import { conflict, jsonHash, notFound, precondition, validation } from '@crewstation/kernel';
import { allocateServicePlan, DEFAULT_NAMESPACE_QUOTA } from '../domain/resourcePolicy';
import { executionQuotaRevision, namespaceQuotaRevision, serviceAllocationRevision } from '../api/resourceRevisions';
import type { RepositoryScope } from '../ports/unitOfWork';
import type { ProjectUseCaseDeps } from './dependencies';
import { authorizationUseCases } from './authorization';

interface Command { operationId: string; target: ResourceTarget; expectedRevision: string; values: ResourceValues }
const namespaceOf = async (scope: RepositoryScope, projectId: ProjectId) => await scope.resourcePolicies.namespace(projectId) ?? { projectId, revision: 0, quota: DEFAULT_NAMESPACE_QUOTA, updatedAt: null };
const revisionIs = (actual: string, expected: string) => { if (actual !== expected) throw conflict('项目资源修订已变化，需要重新审核', { code: 'resource_revision_conflict' }); };

async function apply(scope: RepositoryScope, projectId: ProjectId, actor: Actor, input: Command, now: Date) {
  if (['namespace-quota', 'execution-quota'].includes(input.target.resourceType) && input.target.resourceId !== projectId) throw validation('配额目标必须属于当前项目');
  if (input.target.resourceType === 'namespace-quota' && input.target.action === 'set-quota') {
    const current = await namespaceOf(scope, projectId), quota = NamespaceQuotaSchema.parse(input.values);
    revisionIs(namespaceQuotaRevision(current.revision, current.quota), input.expectedRevision);
    const next = { projectId, quota, revision: current.revision + 1, updatedAt: now.toISOString() };
    if (!await scope.resourcePolicies.saveNamespace(next, current.revision, actor.userId)) throw conflict('项目命名空间配额已变化');
    return { revision: namespaceQuotaRevision(next.revision, quota), effect: '项目配额政策已保存，等待命名空间实际同步', applied: false };
  }
  if (input.target.resourceType === 'execution-quota' && input.target.action === 'set-quota') {
    const current = await scope.quotas.get(projectId); if (!current) throw notFound('项目执行配额');
    revisionIs(executionQuotaRevision(current.maxConcurrentTasks), input.expectedRevision);
    const values = SetQuotaRequestSchema.parse(input.values);
    if (Object.keys(input.values).some((key) => key !== 'maxConcurrentTasks')) throw validation('执行配额参数不适用');
    if (!await scope.quotas.compareAndSet({ projectId, maxConcurrentTasks: values.maxConcurrentTasks }, current.maxConcurrentTasks)) throw conflict('项目执行配额已变化');
    return { revision: executionQuotaRevision(values.maxConcurrentTasks), effect: '新执行额度已生效；已有任务继续运行，超过额度时阻止新增执行', applied: true };
  }
  if (input.target.resourceType !== 'service-plan' || !['grant', 'revoke'].includes(input.target.action)) throw validation('不支持的项目资源变更');
  if (Object.keys(input.values).length) throw validation('服务规格分配不接受配额参数');
  const plan = await scope.catalog.getServicePlan(input.target.resourceId); if (!plan) throw notFound('服务规格');
  const current = await scope.servicePolicies.get(projectId), revision = current?.revision ?? 0;
  revisionIs(serviceAllocationRevision(revision, plan), input.expectedRevision);
  const policy = allocateServicePlan(current?.policy ?? { mode: 'inherit', allowedPlanIds: [] }, plan.id, input.target.action === 'grant');
  if (!await scope.servicePolicies.save({ projectId, policy, revision: revision + 1, updatedBy: actor.userId, updatedAt: now }, revision)) throw conflict('服务规格分配已变化');
  return { revision: serviceAllocationRevision(revision + 1, plan), effect: '项目可选规格已更新；现有部署保持运行，新选择需要发布部署', applied: true };
}

export function projectResourcePolicyUseCases(deps: ProjectUseCaseDeps) {
  const { authorize } = authorizationUseCases(deps);
  return {
    getNamespaceQuota: async (actor: Actor, projectId: ProjectId) => { await authorize(actor, projectId, 'view'); return namespaceOf(deps.uow.read, projectId); },
    namespaceQuota: async (projectId: ProjectId) => (await namespaceOf(deps.uow.read, projectId)).quota,
    resourceChangeReceipt: async (projectId: ProjectId, operationId: string) => { const r = await deps.uow.read.resourcePolicies.receipt(operationId, projectId); return r ? { revision: r.revision, effect: r.effect, applied: r.applied } : undefined; },
    applyResourceChange: async (actor: Actor, projectId: ProjectId, input: Command) => {
      await authorize(actor, projectId, 'manage-quota'); ResourceIdSchema.parse(input.operationId);
      const project = await deps.uow.read.projects.getById(projectId); if (!project || project.state === 'archived') throw precondition('归档项目不能调整资源');
      const hash = jsonHash({ projectId, input });
      return deps.uow.run(async (scope) => {
        await scope.resourcePolicies.lock(projectId);
        const old = await scope.resourcePolicies.receipt(input.operationId, projectId);
        if (old) { if (old.hash !== hash) throw conflict('资源操作标识对应的内容已变化'); return { revision: old.revision, effect: old.effect, applied: old.applied }; }
        const receipt = await apply(scope, projectId, actor, input, deps.clock.now());
        await scope.resourcePolicies.saveReceipt(input.operationId, projectId, { hash, ...receipt });
        return receipt;
      });
    },
  };
}
