import type { Actor, ProjectId, ProjectPageEntry, ProjectPageQuery } from '@crewstation/contracts';
import { ProjectIdSchema, ProjectPageIdsSchema, ProjectPageQuerySchema } from '@crewstation/contracts';
import { notFound, validation } from '@crewstation/kernel';
import { developerActor } from './creation/eligibility';
import type { ProjectUseCaseDeps } from './dependencies';

const scopeOf = (actor: Actor, q: ProjectPageQuery) => JSON.stringify({ v: 2, userId: actor.userId, role: actor.platformRole, isAdmin: actor.isAdmin,
  q: q.q, state: q.state ?? null, owner: q.ownerUserId ?? null, kind: q.kind });
function afterCursor(actor: Actor, query: ProjectPageQuery): ProjectId | undefined {
  if (!query.cursor) return undefined;
  try {
    const cursor = JSON.parse(Buffer.from(query.cursor, 'base64url').toString());
    if (cursor.scope !== scopeOf(actor, query)) throw new Error('scope changed');
    return ProjectIdSchema.parse(cursor.after);
  } catch { throw validation('项目分页已失效，请从第一页重新查询'); }
}

export function projectPageUseCases(deps: ProjectUseCaseDeps) {
  const { uow, users } = deps;
  const withOwners = async (items: ProjectPageEntry[]) => {
    const names = new Map<string, string>();
    const ids = [...new Set(items.map((item) => item.project.ownerUserId))];
    for (let i = 0; i < ids.length; i += 4) await Promise.all(ids.slice(i, i + 4).map(async (id) => {
      try { const user = await users.getUser(id); if (user) names.set(id, user.name); } catch { /* 名称未知，不伪装成不存在的负责人。 */ }
    }));
    return items.map((item) => ({ ...item, ...(names.has(item.project.ownerUserId) ? { ownerName: names.get(item.project.ownerUserId)! } : {}) }));
  };
  const read = async (actor: Actor, ids: readonly ProjectId[]): Promise<ProjectPageEntry[]> => {
    actor = await developerActor(deps, actor);
    const parsed = ProjectPageIdsSchema.safeParse(ids); if (!parsed.success) throw validation('一次最多读取 50 个项目');
    return uow.read.projectPages.list(actor, { q: '', kind: ['DigitalWorker', 'APIProxy', 'EventProducer'], limit: 50, ids: [...new Set(parsed.data)] });
  };
  return {
    listProjectPage: async (actor: Actor, raw: ProjectPageQuery) => {
      actor = await developerActor(deps, actor);
      const parsed = ProjectPageQuerySchema.safeParse(raw); if (!parsed.success) throw validation('项目查询参数无效');
      const query = parsed.data, after = afterCursor(actor, query);
      const rows = await uow.read.projectPages.list(actor, { ...query, limit: query.limit + 1, ...(after ? { after } : {}) });
      const page = rows.slice(0, query.limit), last = page.at(-1);
      return { items: await withOwners(page), ...(rows.length > query.limit && last
        ? { nextCursor: Buffer.from(JSON.stringify({ scope: scopeOf(actor, query), after: last.project.id })).toString('base64url') } : {}) };
    },
    readProjectPageEntries: async (actor: Actor, ids: readonly ProjectId[]) => withOwners(await read(actor, ids)),
    readProjectBasics: async (actor: Actor, ids: readonly ProjectId[]) => (await read(actor, ids)).map((entry) => entry.project),
    getProjectPageEntry: async (actor: Actor, id: ProjectId) => {
      const entry = (await withOwners(await read(actor, [id])))[0]; if (!entry) throw notFound('项目', id); return entry;
    },
  };
}
