import type { Actor, ApiRequestPage, ProjectDto, RequestPageQuery } from '@crewstation/contracts';
import { ApiRequestPageSchema, RequestPageQuerySchema, RequestProjectSchema } from '@crewstation/contracts';
import { forbidden, validation } from '@crewstation/kernel';
import { z } from 'zod';
import type { ApiCatalogUseCaseDeps } from './dependencies';
import { requestToDto } from './toDto';
import { withRequesterNames } from './requesterNames';

const scopeOf = (actor: Actor, q: RequestPageQuery) => JSON.stringify(['api-requests-v1', actor.userId, actor.isAdmin, q.projectId ?? null, q.state]);
const cursorSchema = z.object({ scope: z.string(), before: z.object({ id: z.string().regex(/^req_[0-9a-f]{32}$/), createdAt: z.iso.datetime() }) });
function beforeCursor(actor: Actor, query: RequestPageQuery) {
  if (!query.cursor) return undefined;
  try {
    const cursor = cursorSchema.parse(JSON.parse(Buffer.from(query.cursor, 'base64url').toString()));
    if (cursor.scope !== scopeOf(actor, query)) throw new Error('scope changed');
    return { id: cursor.before.id, createdAt: new Date(cursor.before.createdAt) };
  } catch { throw validation('申请分页已失效，请从第一页重新查询'); }
}

export function requestPageUseCase({ uow, projects, users }: ApiCatalogUseCaseDeps) {
  return async (actor: Actor, raw: RequestPageQuery): Promise<ApiRequestPage> => {
    const parsed = RequestPageQuerySchema.safeParse(raw); if (!parsed.success) throw validation('申请查询参数无效');
    const query = parsed.data;
    if (query.projectId) await projects.authorize(actor, query.projectId, 'view');
    else if (!actor.isAdmin) throw forbidden('只有管理员可以查看全部申请');
    const rows = await uow.read.requests.listPage({ ...query, limit: query.limit + 1, before: beforeCursor(actor, query) });
    const page = rows.slice(0, query.limit), last = page.at(-1), ids = [...new Set(page.map((r) => r.projectId))];
    let names: ProjectDto[] = [];
    try { if (ids.length) names = await projects.readProjectBasics(actor, ids); } catch { /* 名称来源失败，申请记录和项目 ID 保留。 */ }
    const items = await withRequesterNames(users, page.map((row) => {
      const source = names.find((p) => p.id === row.projectId && p.serviceId === row.serviceId), project = RequestProjectSchema.safeParse(source).data;
      return { ...requestToDto(row), projectId: row.projectId, ...(project ? { project } : {}) };
    }));
    return ApiRequestPageSchema.parse({ items, ...(rows.length > query.limit && last ? {
      nextCursor: Buffer.from(JSON.stringify({ scope: scopeOf(actor, query), before: { id: last.id, createdAt: last.createdAt.toISOString() } })).toString('base64url'),
    } : {}) });
  };
}
