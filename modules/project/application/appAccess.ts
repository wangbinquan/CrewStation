import type { Actor, AppAccessRequestDto, AppAccessStatusDto, CreateAppAccessRequest, ProjectId, UserId } from '@crewstation/contracts';
import { CreateAppAccessRequestSchema } from '@crewstation/contracts';
import { conflict, forbidden, newId, notFound, precondition, validation } from '@crewstation/kernel';
import type { AppAccessVerdict } from '../api/moduleApi';
import type { AccessRequest } from '../domain/accessRequest';
import { acceptsRequests, canUseApp } from '../domain/appAccess';
import { accessRequestDto } from './accessRequestReview';
import { currentActor } from './creation/eligibility';
import type { ProjectUseCaseDeps } from './dependencies';

/**
 * 正式地址的使用权（2026-09-24 裁定，RFC-003 §3 修订）：网关每个正式地址请求问一次；没有使用权的人在工作台申请页读状态、提交申请。
 * 判定规则只有 domain/appAccess.ts 一处，市场可见（drizzleAppListings 的 visibleTo）与它同一条。
 */
export function appAccessUseCases(deps: ProjectUseCaseDeps) {
  const { uow, users, hosts, clock } = deps;
  const ownerName = async (ownerUserId: UserId) => (await users.getUser(ownerUserId).catch(() => undefined))?.name ?? '—';
  const load = async (projectId: ProjectId, userId: UserId) => {
    const found = await uow.read.appListings.accessFacts({ projectId }, userId);
    if (!found || found.project.state === 'archived') throw notFound('应用', projectId);
    return found;
  };
  return {
    appAccessBySlug: async (user: { readonly id: UserId; readonly isAdmin: boolean }, projectSlug: string): Promise<AppAccessVerdict> => {
      const found = await uow.read.appListings.accessFacts({ slug: projectSlug }, user.id);
      if (!found || found.project.state === 'archived') return { kind: 'unknown' };
      if (canUseApp(found.facts, user.isAdmin)) return { kind: 'allowed' };
      return { kind: 'denied', projectId: found.project.id, appName: found.project.name, ownerName: await ownerName(found.project.ownerUserId), requestable: acceptsRequests(found.facts) };
    },
    getAppAccessStatus: async (actor: Actor, projectId: ProjectId): Promise<AppAccessStatusDto> => {
      const fresh = await currentActor(deps, actor), { project, facts } = await load(projectId, fresh.userId);
      const latest = await uow.read.accessRequests.latest(projectId, fresh.userId);
      return {
        projectId, name: project.name, owner: { name: await ownerName(project.ownerUserId) }, granted: canUseApp(facts, fresh.isAdmin),
        allowRequests: acceptsRequests(facts), appHost: hosts.prodHost(project.slug), ...(latest ? { latest: await accessRequestDto(users, latest) } : {}),
      };
    },
    requestAppAccess: async (actor: Actor, projectId: ProjectId, raw: CreateAppAccessRequest): Promise<AppAccessRequestDto> => {
      const input = CreateAppAccessRequestSchema.safeParse(raw ?? {});
      if (!input.success) throw validation('申请理由最多 500 字', { issues: input.error.issues });
      const fresh = await currentActor(deps, actor), { facts } = await load(projectId, fresh.userId);
      if (canUseApp(facts, fresh.isAdmin)) throw precondition('你已经可以使用这个应用', { code: 'already-granted' });
      if (!acceptsRequests(facts)) throw forbidden('负责人没有开放申请，请联系项目负责人');
      const reason = input.data.reason || undefined;
      const request: AccessRequest = { id: newId('aar'), projectId, requestedBy: fresh.userId, state: 'pending', ...(reason ? { reason } : {}), createdAt: clock.now() };
      if (!(await uow.run((scope) => scope.accessRequests.insert(request)))) throw conflict('你已经申请过这个应用，正在等负责人处理', { code: 'already-pending' });
      return accessRequestDto(users, request);
    },
  };
}
