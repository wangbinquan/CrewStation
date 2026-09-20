import type { CreateServicePlan, CreateTaskProfile, Actor, ProjectId, QuotaDto, ServicePlanDto, ServicePlanWrite, SetQuotaRequest, TaskProfileDto, TaskProfileWrite } from '@crewstation/contracts';
import { ResourceIdSchema } from '@crewstation/contracts';
import { forbidden, newResourceId, notFound } from '@crewstation/kernel';
import { authorizationUseCases } from './authorization';
import type { ProjectUseCaseDeps } from './dependencies';

export function quotaAndPlanUseCases(deps: ProjectUseCaseDeps) {
  const { uow, taskUsage } = deps;
  const { authorize } = authorizationUseCases(deps);
  const adminOnly = (actor: Actor): void => {
    if (!actor.isAdmin) throw forbidden('只有管理员可以维护套餐与配额');
  };
  // 算力档位的用例在 manageComputeProfiles.ts（RFC-004 之后含绑定与就绪投影）。
  return {
    getQuota: async (actor: Actor, projectId: ProjectId): Promise<QuotaDto> => {
      await authorize(actor, projectId, 'view');
      const quota = await uow.read.quotas.get(projectId);
      if (!quota) throw notFound('配额', projectId);
      return { maxConcurrentTasks: quota.maxConcurrentTasks, running: await taskUsage.runningTasks(projectId) };
    },
    setQuota: async (actor: Actor, projectId: ProjectId, input: SetQuotaRequest): Promise<QuotaDto> => {
      adminOnly(actor);
      await authorize(actor, projectId, 'manage-quota');
      await uow.run((scope) => scope.quotas.upsert({ projectId, maxConcurrentTasks: input.maxConcurrentTasks }));
      return { maxConcurrentTasks: input.maxConcurrentTasks, running: await taskUsage.runningTasks(projectId) };
    },
    /** 供 task-runtime 原子准入时读取上限。 */
    quotaLimit: async (projectId: ProjectId): Promise<number | undefined> => (await uow.read.quotas.get(projectId))?.maxConcurrentTasks,
    listServicePlans: (): Promise<ServicePlanDto[]> => uow.read.catalog.listServicePlans(),
    createServicePlan: async (actor: Actor, input: CreateServicePlan): Promise<ServicePlanDto> => {
      adminOnly(actor);
      const plan = { ...input, id: input.id ? ResourceIdSchema.parse(input.id) : newResourceId() };
      await uow.run((scope) => scope.catalog.createServicePlan(plan));
      return plan;
    },
    updateServicePlan: async (actor: Actor, id: string, input: ServicePlanWrite): Promise<ServicePlanDto> => {
      adminOnly(actor);
      const plan = { ...input, id };
      if (!await uow.run((scope) => scope.catalog.updateServicePlan(plan))) throw notFound('服务套餐', id);
      return plan;
    },
    updateTaskProfile: async (actor: Actor, id: string, input: TaskProfileWrite): Promise<TaskProfileDto> => {
      adminOnly(actor);
      const profile = { ...input, id };
      if (!await uow.run((scope) => scope.catalog.updateTaskProfile(profile))) throw notFound('任务规格', id);
      return profile;
    },
    listTaskProfiles: (): Promise<TaskProfileDto[]> => uow.read.catalog.listTaskProfiles(),
    createTaskProfile: async (actor: Actor, input: CreateTaskProfile): Promise<TaskProfileDto> => {
      adminOnly(actor);
      const profile = { ...input, id: input.id ? ResourceIdSchema.parse(input.id) : newResourceId() };
      await uow.run((scope) => scope.catalog.createTaskProfile(profile));
      return profile;
    },
  };
}
