import type { Actor, MarketAppsQuery, ProjectId } from '@crewstation/contracts';
import { MarketAppsQuerySchema, ProjectIdSchema } from '@crewstation/contracts';
import { notFound, validation } from '@crewstation/kernel';
import type { MarketListing } from '../api/moduleApi';
import type { VisibleApplication } from '../ports/appListings';
import type { ProjectUseCaseDeps } from './dependencies';

function readCursor(actor: Actor, query: MarketAppsQuery): ProjectId | undefined {
  if (!query.cursor) return undefined;
  try {
    const value = JSON.parse(Buffer.from(query.cursor, 'base64url').toString());
    if (value.userId !== actor.userId || value.q !== query.q) throw new Error('scope changed');
    return ProjectIdSchema.parse(value.after);
  } catch { throw validation('市场分页已失效，请从第一页重新查询'); }
}

export function marketListingUseCases({ uow, users, clock }: ProjectUseCaseDeps) {
  const toListing = async ({ project, service, listing, role }: VisibleApplication, actor: Actor): Promise<MarketListing> => ({
    projectId: project.id, name: project.name, description: listing.description, icon: listing.icon,
    owner: { userId: project.ownerUserId, name: (await users.getUser(project.ownerUserId))?.name ?? project.ownerUserId },
    projectState: project.state, canDevelop: actor.isAdmin || project.ownerUserId === actor.userId || role === 'owner' || role === 'developer',
    canConfigure: actor.isAdmin || project.ownerUserId === actor.userId || role === 'owner',
    visibilityRevision: listing.revision, checkedAt: clock.now().toISOString(), ...(service ? { serviceId: service.id } : {}),
  });
  return {
    listMarketListings: async (actor: Actor, raw: MarketAppsQuery) => {
      const parsed = MarketAppsQuerySchema.safeParse(raw);
      if (!parsed.success) throw validation('市场查询参数无效');
      const query = parsed.data, after = readCursor(actor, query);
      const rows = await uow.read.appListings.visible(actor, { q: query.q, ...(after ? { after } : {}), limit: query.limit + 1 });
      const page = rows.slice(0, query.limit), last = page.at(-1);
      return {
        items: await Promise.all(page.map((row) => toListing(row, actor))),
        ...(rows.length > query.limit && last ? { nextCursor: Buffer.from(JSON.stringify({ userId: actor.userId, q: query.q, after: last.project.id })).toString('base64url') } : {}),
      };
    },
    getMarketListing: async (actor: Actor, projectId: ProjectId) => {
      const row = (await uow.read.appListings.visible(actor, { projectId, q: '', limit: 1 }))[0];
      if (!row) throw notFound('应用', projectId);
      return toListing(row, actor);
    },
  };
}
