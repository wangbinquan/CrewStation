import type { Actor, AppAccessRequestDto, AppAccessRequestPage, DecideAppAccessRequest, RequestPageQuery, UserDto, UserId } from '@crewstation/contracts';
import { AppAccessRequestPageSchema, DecideAppAccessRequestSchema, RequestPageQuerySchema, ResourceIdSchema } from '@crewstation/contracts';
import { forbidden, notFound, precondition, validation } from '@crewstation/kernel';
import { z } from 'zod';
import type { AccessRequest } from '../domain/accessRequest';
import { decideAccessRequest } from '../domain/accessRequest';
import type { UserDirectory } from '../ports/userDirectory';
import { authorizationUseCases } from './authorization';
import { currentActor } from './creation/eligibility';
import type { ProjectUseCaseDeps } from './dependencies';

/** 申请人与裁决人的名字随 DTO 带回；目录查不到时省略，界面回退到 ID。`known` 让一页里同一个人只查一次。 */
export async function accessRequestDto(users: Pick<UserDirectory, 'getUser'>, request: AccessRequest, known = new Map<UserId, UserDto | undefined>()): Promise<AppAccessRequestDto> {
  const lookup = async (id: UserId) => {
    if (!known.has(id)) known.set(id, await users.getUser(id).catch(() => undefined));
    return known.get(id);
  };
  const requester = await lookup(request.requestedBy), decider = request.decidedBy ? await lookup(request.decidedBy) : undefined;
  return {
    id: request.id, projectId: request.projectId, state: request.state, ...(request.reason ? { reason: request.reason } : {}),
    requestedBy: request.requestedBy, ...(requester ? { requestedByName: requester.name, requestedByEmail: requester.email } : {}),
    ...(request.decidedBy ? { decidedBy: request.decidedBy } : {}), ...(decider ? { decidedByName: decider.name } : {}),
    ...(request.decision ? { decision: request.decision } : {}), createdAt: request.createdAt.toISOString(),
    ...(request.decidedAt ? { decidedAt: request.decidedAt.toISOString() } : {}),
  };
}

const scopeOf = (actor: Actor, q: RequestPageQuery) => JSON.stringify(['app-access-requests-v1', actor.userId, actor.isAdmin, q.projectId ?? null, q.state]);
const cursorSchema = z.object({ scope: z.string(), before: z.object({ id: ResourceIdSchema, createdAt: z.iso.datetime() }) });
function beforeCursor(actor: Actor, query: RequestPageQuery) {
  if (!query.cursor) return undefined;
  try {
    const cursor = cursorSchema.parse(JSON.parse(Buffer.from(query.cursor, 'base64url').toString()));
    if (cursor.scope !== scopeOf(actor, query)) throw new Error('scope changed');
    return { id: cursor.before.id, createdAt: new Date(cursor.before.createdAt) };
  } catch { throw validation('申请分页已失效，请从第一页重新查询'); }
}

/** 负责人与管理员处理使用申请：项目内清单（应用可见性页、概览提醒）与管理空间的全局清单共用一个查询。 */
export function accessRequestReviewUseCases(deps: ProjectUseCaseDeps) {
  const { uow, users, clock } = deps, { authorize } = authorizationUseCases(deps);
  return {
    listAppAccessRequests: async (actor: Actor, raw: RequestPageQuery): Promise<AppAccessRequestPage> => {
      const parsed = RequestPageQuerySchema.safeParse(raw); if (!parsed.success) throw validation('申请查询参数无效');
      const query = parsed.data, fresh = await currentActor(deps, actor);
      if (query.projectId) await authorize(fresh, query.projectId, 'manage-members');
      else if (!fresh.isAdmin) throw forbidden('只有管理员可以查看全部申请');
      const before = beforeCursor(fresh, query);
      const rows = await uow.read.accessRequests.listPage({ state: query.state, limit: query.limit + 1, ...(query.projectId ? { projectId: query.projectId } : {}), ...(before ? { before } : {}) });
      const page = rows.slice(0, query.limit), last = page.at(-1), known = new Map<UserId, UserDto | undefined>();
      const projects = query.projectId ? [] : await uow.read.projects.listByIds([...new Set(page.map((row) => row.projectId))]);
      const items: AppAccessRequestDto[] = [];
      for (const row of page) {
        const dto = await accessRequestDto(users, row, known), project = projects.find((p) => p.id === row.projectId);
        items.push(project ? { ...dto, project: { id: project.id, name: project.name, slug: project.slug, kind: project.kind } } : dto);
      }
      return AppAccessRequestPageSchema.parse({ items, ...(rows.length > query.limit && last ? {
        nextCursor: Buffer.from(JSON.stringify({ scope: scopeOf(fresh, query), before: { id: last.id, createdAt: last.createdAt.toISOString() } })).toString('base64url'),
      } : {}) });
    },
    decideAppAccessRequest: async (actor: Actor, requestId: string, raw: DecideAppAccessRequest): Promise<AppAccessRequestDto> => {
      const input = DecideAppAccessRequestSchema.safeParse(raw); if (!input.success) throw validation('审批意见最多 500 字', { issues: input.error.issues });
      const current = await uow.read.accessRequests.getById(requestId); if (!current) throw notFound('申请', requestId);
      const fresh = await currentActor(deps, actor);
      await authorize(fresh, current.projectId, 'manage-members');
      const decided = decideAccessRequest(current, input.data.approve, fresh.userId, input.data.decision || undefined, clock.now());
      await uow.run(async (scope) => {
        if (!(await scope.accessRequests.decide(decided))) throw precondition('这条申请已经处理过了', { state: 'decided' });
        // 批准即加为「用户」；申请之后已经成了成员（负责人直接加过）的保留原角色，不降级。
        if (decided.state === 'approved' && !(await scope.memberships.get(decided.projectId, decided.requestedBy))) {
          await scope.memberships.upsert({ projectId: decided.projectId, userId: decided.requestedBy, role: 'user' });
        }
      });
      return accessRequestDto(users, decided);
    },
  };
}
