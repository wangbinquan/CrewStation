import type { Actor, AppPresentationDto, AppVisibilityDto, ProjectId, SetAppPresentationRequest, SetAppVisibilityRequest } from '@crewstation/contracts';
import { SetAppPresentationRequestSchema, SetAppVisibilityRequestSchema, UserIdSchema } from '@crewstation/contracts';
import { conflict, notFound, validation } from '@crewstation/kernel';
import type { AppListing } from '../domain/appListing';
import { authorizationUseCases } from './authorization';
import type { ProjectUseCaseDeps } from './dependencies';

export function appVisibilityUseCases(deps: ProjectUseCaseDeps) {
  const { uow, users, clock } = deps, { authorize, roleOf } = authorizationUseCases(deps);
  const read = async (actor: Actor, projectId: ProjectId) => {
    // 测试者能看本应用的市场设置，但仍没有开发／完整项目 view 权。
    await authorize(actor, projectId, 'view-preview');
    if ((await uow.read.projects.getById(projectId))?.kind !== 'DigitalWorker') throw notFound('应用', projectId);
    return uow.read.appListings.get(projectId);
  };
  const visibility = async (actor: Actor, listing: AppListing): Promise<AppVisibilityDto> => ({
    mode: listing.mode, allowRequests: listing.allowRequests, revision: listing.revision, updatedAt: listing.updatedAt?.toISOString() ?? null,
    canConfigure: ['admin', 'owner'].includes(await roleOf(actor, listing.projectId) ?? ''),
  });
  const save = async (actor: Actor, projectId: ProjectId, expectedRevision: number, delta: Partial<AppListing>) => {
    await authorize(actor, projectId, 'manage-members');
    await read(actor, projectId);
    return uow.run(async (scope) => {
      const current = await scope.appListings.get(projectId);
      const saved = await scope.appListings.save({ ...current, ...delta, updatedAt: clock.now() }, expectedRevision);
      if (!saved) throw conflict('应用设置已由其他人更新；请保留草稿并读取最新设置后重试');
      return saved;
    });
  };
  return {
    getAppVisibility: async (actor: Actor, projectId: ProjectId) => visibility(actor, await read(actor, projectId)),
    setAppVisibility: async (actor: Actor, projectId: ProjectId, raw: SetAppVisibilityRequest) => {
      await authorize(actor, projectId, 'manage-members');
      const input = SetAppVisibilityRequestSchema.safeParse(raw);
      if (!input.success) throw validation('请检查可见范围与申请设置', { issues: input.error.issues });
      return visibility(actor, await save(actor, projectId, input.data.expectedRevision, { mode: input.data.mode, allowRequests: input.data.allowRequests }));
    },
    getAppPresentation: async (actor: Actor, projectId: ProjectId) => presentation(await read(actor, projectId)),
    setAppPresentation: async (actor: Actor, projectId: ProjectId, raw: SetAppPresentationRequest) => {
      await authorize(actor, projectId, 'manage-members');
      const input = SetAppPresentationRequestSchema.safeParse(raw);
      if (!input.success) throw validation('请检查应用介绍', { issues: input.error.issues });
      return presentation(await save(actor, projectId, input.data.expectedRevision, { description: input.data.description, icon: input.data.icon }));
    },
    memberCandidates: async (actor: Actor, projectId: ProjectId, identity: string) => {
      await authorize(actor, projectId, 'manage-members');
      const parsed = UserIdSchema.safeParse(identity.trim());
      const user = parsed.success ? await users.getUser(parsed.data) : await users.findByEmail(identity.trim());
      return user ? [{ userId: user.id, name: user.name, email: user.email, platformRole: user.platformRole }] : [];
    },
  };
}

function presentation(listing: AppListing): AppPresentationDto {
  return { description: listing.description, icon: listing.icon, revision: listing.revision, updatedAt: listing.updatedAt?.toISOString() ?? null };
}
