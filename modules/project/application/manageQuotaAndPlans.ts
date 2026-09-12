import type { Actor, ComputeProfileDto, ComputeProfileSummaryDto, ProjectId, QuotaDto, ServicePlanDto, SetQuotaRequest, TaskProfileDto } from '@crewstation/contracts';
import { forbidden, notFound } from '@crewstation/kernel';
import { authorizationUseCases } from './authorization';
import type { ProjectUseCaseDeps } from './dependencies';

export function quotaAndPlanUseCases(deps: ProjectUseCaseDeps) {
  const { uow, taskUsage } = deps;
  const { authorize } = authorizationUseCases(deps);
  const adminOnly = (actor: Actor): void => {
    if (!actor.isAdmin) throw forbidden('只有管理员可以维护套餐与配额');
  };
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
    upsertServicePlan: async (actor: Actor, plan: ServicePlanDto): Promise<ServicePlanDto> => {
      adminOnly(actor);
      await uow.run((scope) => scope.catalog.upsertServicePlan(plan));
      return plan;
    },
    listTaskProfiles: (): Promise<TaskProfileDto[]> => uow.read.catalog.listTaskProfiles(),
    upsertTaskProfile: async (actor: Actor, profile: TaskProfileDto): Promise<TaskProfileDto> => {
      adminOnly(actor);
      await uow.run((scope) => scope.catalog.upsertTaskProfile(profile));
      return profile;
    },
    /** 租户面投影：只给名字与说明，不泄露厂商与模型标识符（RFC-001）。 */
    listComputeProfiles: async (): Promise<ComputeProfileSummaryDto[]> =>
      (await uow.read.catalog.listComputeProfiles()).map((p) => ({ name: p.name, description: p.description })),
    listComputeProfilesFull: async (actor: Actor): Promise<ComputeProfileDto[]> => {
      adminOnly(actor);
      return uow.read.catalog.listComputeProfiles();
    },
    upsertComputeProfile: async (actor: Actor, profile: ComputeProfileDto): Promise<ComputeProfileDto> => {
      adminOnly(actor);
      await uow.run((scope) => scope.catalog.upsertComputeProfile(profile));
      return profile;
    },
    deleteComputeProfile: async (actor: Actor, name: string): Promise<void> => {
      adminOnly(actor);
      await uow.run((scope) => scope.catalog.deleteComputeProfile(name));
    },
    /** 供 dev-session、business-task、release 解析档位名 → 具体驱动与模型。 */
    resolveComputeProfile: (name: string): Promise<ComputeProfileDto | undefined> => uow.read.catalog.getComputeProfile(name),
  };
}
