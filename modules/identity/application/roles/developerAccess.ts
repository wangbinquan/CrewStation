import type { DeveloperAccessQuery, DeveloperAccessRequestDto, RequestDeveloperAccess, ResourceId, ReviewDeveloperAccess, UserId } from '@crewstation/contracts';
import { RequestDeveloperAccessSchema, ReviewDeveloperAccessSchema } from '@crewstation/contracts';
import type { Clock } from '@crewstation/kernel';
import { conflict, forbidden, newResourceId, notFound, precondition } from '@crewstation/kernel';
import type { DeveloperAccessScope, DeveloperAccessUnitOfWork } from '../../ports/access/developerAccess';

async function requireAdmin(scope: DeveloperAccessScope, actor: UserId) {
  if ((await scope.users.getById(actor))?.platformRole !== 'admin') throw forbidden('只有管理员可以审批开发者权限');
}

export function developerAccessUseCases(uow: DeveloperAccessUnitOfWork, clock: Clock) {
  return {
    myDeveloperAccess: async (userId: UserId) => ({ request: await uow.read.requests.latest(userId) ?? null }),
    requestDeveloperAccess: async (userId: UserId, raw: RequestDeveloperAccess): Promise<DeveloperAccessRequestDto> => uow.run(userId, async scope => {
      const input = RequestDeveloperAccessSchema.parse(raw), user = await scope.users.getById(userId);
      if (!user) throw notFound('用户', userId);
      if (user.platformRole !== 'user') throw precondition('你已具备创建项目的权限，请重新读取身份');
      const latest = await scope.requests.latest(userId);
      if (latest?.state === 'pending') return latest;
      const request: DeveloperAccessRequestDto = { id: newResourceId(), userId, userName: user.name, userEmail: user.email, reason: input.reason,
        state: 'pending', revision: 1, createdAt: clock.now().toISOString(), reviewerId: null, reviewedAt: null, note: null };
      await scope.requests.insert(request); return request;
    }),
    listDeveloperAccess: async (actor: UserId, query: DeveloperAccessQuery) => { await requireAdmin(uow.read, actor); return uow.read.requests.list(query); },
    reviewDeveloperAccess: async (actor: UserId, id: ResourceId, raw: ReviewDeveloperAccess): Promise<DeveloperAccessRequestDto> => {
      await requireAdmin(uow.read, actor);
      const input = ReviewDeveloperAccessSchema.parse(raw), request = await uow.read.requests.get(id);
      if (!request) throw notFound('开发权限申请', id);
      return uow.run(request.userId, async scope => {
        await requireAdmin(scope, actor);
        const current = await scope.requests.get(id), user = await scope.users.getById(request.userId);
        if (!current || !user) throw notFound('开发权限申请', id);
        if (actor === current.userId) throw forbidden('不能审批自己的开发权限申请');
        if (current.state !== 'pending' || current.revision !== input.expectedRevision) throw conflict('申请已处理，请重新读取');
        if (input.decision === 'approved') {
          if (user.platformRole !== 'user') throw conflict('申请人的平台角色已变化，请重新核对');
          await scope.users.setPlatformRole(user.id, 'developer');
        }
        const updated = { ...current, state: input.decision, revision: current.revision + 1, reviewerId: actor, reviewedAt: clock.now().toISOString(), note: input.note };
        await scope.requests.update(updated, current.revision); return updated;
      });
    },
  };
}
