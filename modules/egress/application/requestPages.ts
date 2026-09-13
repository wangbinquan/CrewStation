import type { Actor, EgressRequestPage, ProjectDto, RequestPageQuery } from '@crewstation/contracts';
import { EgressRequestPageSchema, RequestPageQuerySchema, RequestProjectSchema } from '@crewstation/contracts';
import { validation } from '@crewstation/kernel';
import { z } from 'zod';
import type { EgressUseCaseDeps } from './dependencies';
import { requestToDto } from './toDto';

const scopeOf = (actor: Actor, q: RequestPageQuery) => JSON.stringify(['egress-requests-v1', actor.userId, actor.isAdmin, q.projectId ?? null, q.state]);
const cursorSchema = z.object({ scope: z.string(), before: z.object({ id: z.string().regex(/^egq_[0-9a-f]{32}$/), createdAt: z.iso.datetime() }) });
function beforeCursor(actor: Actor, query: RequestPageQuery) {
  if (!query.cursor) return undefined;
  try {
    const cursor = cursorSchema.parse(JSON.parse(Buffer.from(query.cursor, 'base64url').toString()));
    if (cursor.scope !== scopeOf(actor, query)) throw new Error('scope changed');
    return { id: cursor.before.id, createdAt: new Date(cursor.before.createdAt) };
  } catch { throw validation('申请分页已失效，请从第一页重新查询'); }
}

export function requestPageUseCase({ uow, authorizer }: EgressUseCaseDeps) {
  return async (actor: Actor, raw: RequestPageQuery): Promise<EgressRequestPage> => {
    const parsed = RequestPageQuerySchema.safeParse(raw); if (!parsed.success) throw validation('申请查询参数无效');
    const query = parsed.data;
    if (query.projectId) await authorizer.authorize(actor, query.projectId, 'view');
    else if (!actor.isAdmin) throw validation('非管理员必须指定 projectId');
    const rows = await uow.read.requests.listPage({ ...query, limit: query.limit + 1, before: beforeCursor(actor, query) });
    const page = rows.slice(0, query.limit), last = page.at(-1), ids = [...new Set(page.map((r) => r.projectId))];
    let names: ProjectDto[] = [];
    try { if (ids.length) names = await authorizer.readProjectBasics(actor, ids); } catch { /* 名称失败不遮掉申请和原始项目 ID。 */ }
    const items = page.map((row) => {
      const project = RequestProjectSchema.safeParse(names.find((p) => p.id === row.projectId)).data;
      return { ...requestToDto(row), ...(project ? { project } : {}) };
    });
    return EgressRequestPageSchema.parse({ items, ...(rows.length > query.limit && last ? {
      nextCursor: Buffer.from(JSON.stringify({ scope: scopeOf(actor, query), before: { id: last.id, createdAt: last.createdAt.toISOString() } })).toString('base64url'),
    } : {}) });
  };
}
