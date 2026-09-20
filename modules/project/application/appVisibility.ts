import type { Actor, AppPresentationDto, AppVisibilityDto, ProjectId, SetAppPresentationRequest, SetAppVisibilityRequest, UserId } from '@crewstation/contracts';
import { SetAppPresentationRequestSchema, SetAppVisibilityRequestSchema, UserIdSchema } from '@crewstation/contracts';
import { conflict, notFound, validation } from '@crewstation/kernel';
import type { AppListing } from '../domain/appListing';
import { appVisibilityBasis } from '../domain/appListing';
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
    mode: listing.mode, userIds: listing.userIds, revision: listing.revision, updatedAt: listing.updatedAt?.toISOString() ?? null,
    canConfigure: ['admin', 'owner'].includes(await roleOf(actor, listing.projectId) ?? ''),
    users: (await Promise.all(listing.userIds.map((id) => users.getUser(id)))).flatMap((user) => user ? [{ userId: user.id, name: user.name, email: user.email }] : []),
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
      if (!input.success) throw validation('请检查可见范围与指定用户', { issues: input.error.issues });
      for (const userId of input.data.userIds) if (!await users.getUser(userId)) throw validation('指定用户不存在，请重新查找', { field: 'userIds', userId });
      return visibility(actor, await save(actor, projectId, input.data.expectedRevision, { mode: input.data.mode, userIds: input.data.userIds }));
    },
    checkAppVisibility: async (actor: Actor, projectId: ProjectId, userId: UserId) => {
      await authorize(actor, projectId, 'manage-members');
      const listing = await read(actor, projectId), user = await users.getUser(userId);
      if (!user) throw validation('用户不存在');
      const role = (await uow.read.memberships.get(projectId, userId))?.role;
      const basis = appVisibilityBasis({ userId, isAdmin: await users.isAdmin(userId) }, role, listing);
      return { userId, revision: listing.revision, visible: basis !== 'hidden', basis, checkedAt: clock.now().toISOString() };
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
