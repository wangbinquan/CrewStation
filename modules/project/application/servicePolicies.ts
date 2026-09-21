import type { Actor, ProjectId, ProjectServicePolicy, ProjectServicePolicyDto, SaveProjectServicePolicy } from '@crewstation/contracts';
import { SaveProjectServicePolicySchema } from '@crewstation/contracts';
import { conflict, PlatformError, notFound, validation } from '@crewstation/kernel';
import { authorizationUseCases } from './authorization';
import type { ProjectUseCaseDeps } from './dependencies';

const inherited: ProjectServicePolicy = { mode: 'inherit', allowedPlanIds: [] };

export function servicePolicyUseCases(deps: ProjectUseCaseDeps) {
  const { uow, clock } = deps, { authorize } = authorizationUseCases(deps);
  const exists = async (projectId: ProjectId) => { if (!await uow.read.projects.getById(projectId)) throw notFound('项目', projectId); };
  const getServicePolicy = async (actor: Actor, projectId: ProjectId): Promise<ProjectServicePolicyDto> => {
    await authorize(actor, projectId, 'view'); await exists(projectId);
    const record = await uow.read.servicePolicies.get(projectId);
    return { projectId, revision: record?.revision ?? 0, policy: record?.policy ?? inherited, updatedAt: record?.updatedAt.toISOString() ?? null };
  };
  return {
    getServicePolicy,
    listProjectServicePlans: async (actor: Actor, projectId: ProjectId) => {
      const { policy } = await getServicePolicy(actor, projectId), plans = await uow.read.catalog.listServicePlans();
      return policy.mode === 'inherit' ? plans : plans.filter((plan) => policy.allowedPlanIds.includes(plan.id));
    },
    saveServicePolicy: async (actor: Actor, projectId: ProjectId, raw: SaveProjectServicePolicy): Promise<ProjectServicePolicyDto> => {
      await authorize(actor, projectId, 'manage-quota'); await exists(projectId);
      const { policy, expectedRevision } = SaveProjectServicePolicySchema.parse(raw);
      for (const id of policy.allowedPlanIds) if (!await uow.read.catalog.getServicePlan(id)) throw validation(`服务规格 ${id} 不存在，请重新读取目录`, { field: 'allowedPlanIds' });
      const record = { projectId, policy, revision: expectedRevision + 1, updatedBy: actor.userId, updatedAt: clock.now() };
      if (!await uow.run((scope) => scope.servicePolicies.save(record, expectedRevision))) throw conflict('项目服务规格配置已变化，请重新读取后核对；本次修改未保存', { code: 'project_service_revision_conflict' });
      return { projectId, revision: record.revision, policy, updatedAt: record.updatedAt.toISOString() };
    },
    resolveProjectServicePlan: async (projectId: ProjectId, planId: string) => {
      await exists(projectId);
      const policy = (await uow.read.servicePolicies.get(projectId))?.policy ?? inherited;
      if (policy.mode === 'restricted' && !policy.allowedPlanIds.includes(planId)) throw new PlatformError('forbidden', `项目未获分配服务规格 ${planId}，请管理员在项目资源配置中调整`, { code: 'project_service_plan_forbidden', projectId, planId });
      return uow.read.catalog.getServicePlan(planId);
    },
  };
}
