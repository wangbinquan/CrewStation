import { BUILTIN_RESOURCES } from '@crewstation/contracts';
import type { Actor, CreateProjectRequest, UserId } from '@crewstation/contracts';
import { forbidden, validation } from '@crewstation/kernel';
import type { ProjectUseCaseDeps } from '../dependencies';

export async function currentActor(deps: Pick<ProjectUseCaseDeps, 'users'>, actor: Actor): Promise<Actor> {
  // This reserved identity is used only by platform composition, never issued to a user.
  if (actor.userId === BUILTIN_RESOURCES.systemActor && actor.isAdmin) return { ...actor, platformRole: 'admin' };
  const role = (await deps.users.getUser(actor.userId))?.platformRole ?? 'user';
  return { userId: actor.userId, isAdmin: role === 'admin', platformRole: role };
}

export async function developerActor(deps: Pick<ProjectUseCaseDeps, 'users'>, actor: Actor): Promise<Actor> {
  const fresh = await currentActor(deps, actor);
  if (fresh.platformRole === 'user') throw forbidden('只有开发者或管理员可以进入项目开发');
  return fresh;
}

export async function validateCreation(deps: ProjectUseCaseDeps, actor: Actor, input: CreateProjectRequest): Promise<UserId> {
  const fresh = await developerActor(deps, actor);
  if (!fresh.isAdmin) {
    for (const field of ['plan', 'maxConcurrentTasks'] as const) {
      if (input[field] !== undefined) throw validation('自建项目使用平台默认资源', { field });
    }
    if (input.kind !== 'DigitalWorker') throw validation('开发者只能创建应用项目', { field: 'kind' });
    if (input.ownerUserId !== undefined && input.ownerUserId !== actor.userId) throw validation('自建项目的负责人必须是本人', { field: 'ownerUserId' });
    if (!(await deps.creationTemplates.list()).some((t) => t.id === input.template && t.kind === 'DigitalWorker')) throw validation('请选择可用的应用模板', { field: 'template' });
  }
  const ownerId = input.ownerUserId ?? actor.userId;
  const owner = await deps.users.getUser(ownerId);
  if (!owner || owner.platformRole === 'user') throw validation('负责人必须是开发者或管理员', { field: 'ownerUserId' });
  return ownerId;
}

export function creationCatalogUseCase(deps: ProjectUseCaseDeps) {
  return async (actor: Actor) => {
    await developerActor(deps, actor);
    const plan = await deps.uow.read.catalog.getServicePlan(deps.settings.defaultServicePlan);
    if (!plan) throw validation('平台默认资源尚未配置，请联系管理员');
    return { templates: (await deps.creationTemplates.list()).filter((t) => t.kind === 'DigitalWorker'), defaultServicePlan: plan.id, maxConcurrentTasks: deps.settings.defaultMaxConcurrentTasks };
  };
}
