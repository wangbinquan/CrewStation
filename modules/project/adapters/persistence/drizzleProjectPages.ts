import type { Executor } from '@crewstation/persistence';
import { ProjectPageEntrySchema } from '@crewstation/contracts';
import { and, eq, gt, inArray, sql } from 'drizzle-orm';
import type { ProjectPageRepository } from '../../ports/projectPages';
import { memberships, projects, services } from './tables';

export function drizzleProjectPages(db: Executor): ProjectPageRepository {
  return { list: async (actor, query) => {
    if (query.ids?.length === 0) return [];
    const rows = await db.select({ project: projects, serviceId: services.id, role: memberships.role })
      .from(projects).leftJoin(services, eq(services.projectId, projects.id))
      .leftJoin(memberships, and(eq(memberships.projectId, projects.id), eq(memberships.userId, actor.userId)))
      .where(and(actor.isAdmin ? undefined : sql`${memberships.userId} IS NOT NULL`,
        inArray(projects.kind, query.kind), query.state ? eq(projects.state, query.state) : undefined,
        query.ownerUserId ? eq(projects.ownerUserId, query.ownerUserId) : undefined,
        query.after ? gt(projects.id, query.after) : undefined, query.ids ? inArray(projects.id, [...query.ids]) : undefined,
        query.q ? sql`position(lower(${query.q}) in lower(${projects.name} || ' ' || ${projects.slug})) > 0` : undefined,
      )).orderBy(projects.id).limit(query.limit);
    return rows.map(({ project, serviceId, role }) => ProjectPageEntrySchema.parse({
      project: { ...project, serviceId: serviceId ?? undefined, message: project.message ?? undefined, createdAt: project.createdAt.toISOString() },
      role: actor.isAdmin ? 'admin' : role,
    }));
  } };
}
