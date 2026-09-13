import type { Actor, MemberRole, ProjectId, ProjectState, ServiceId, UserId } from '@crewstation/contracts';
import type { Executor } from '@crewstation/persistence';
import { jsonDocument } from '@crewstation/persistence';
import { and, eq, gt, or, sql } from 'drizzle-orm';
import { integer, text, timestamp } from 'drizzle-orm/pg-core';
import type { AppListing } from '../../domain/appListing';
import { defaultAppListing } from '../../domain/appListing';
import type { AppListingRepository, VisibleApplication } from '../../ports/appListings';
import { projectSchema } from './schema';
import { memberships, projects, services } from './tables';

export const appListings = projectSchema.table('app_listings', {
  projectId: text('project_id').primaryKey(), description: text('description').notNull(), icon: text('icon').notNull(),
  mode: text('mode').notNull(), userIds: jsonDocument('user_ids').$type<UserId[]>().notNull(), revision: integer('revision').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }),
});
const asListing = (row: typeof appListings.$inferSelect): AppListing => ({ ...row, projectId: row.projectId as ProjectId, mode: row.mode as AppListing['mode'], icon: row.icon as AppListing['icon'] });

function visibleTo(actor: Actor) {
  return actor.isAdmin ? sql`true` : or(
    eq(projects.ownerUserId, actor.userId), sql`${memberships.userId} IS NOT NULL`, eq(appListings.mode, 'authenticated'),
    and(eq(appListings.mode, 'selected'), sql`${appListings.userIds} @> ${JSON.stringify([actor.userId])}::text::jsonb`),
  );
}

export function drizzleAppListings(db: Executor): AppListingRepository {
  return {
    get: async (projectId) => {
      const row = (await db.select().from(appListings).where(eq(appListings.projectId, projectId)))[0];
      return row ? asListing(row) : defaultAppListing(projectId);
    },
    save: async (listing, expectedRevision) => {
      const value = { ...listing, revision: expectedRevision + 1 };
      const rows = expectedRevision === 0
        ? await db.insert(appListings).values(value).onConflictDoUpdate({ target: appListings.projectId, set: value, setWhere: eq(appListings.revision, 0) }).returning()
        : await db.update(appListings).set(value).where(and(eq(appListings.projectId, listing.projectId), eq(appListings.revision, expectedRevision))).returning();
      return rows[0] ? asListing(rows[0]) : undefined;
    },
    visible: async (actor, query) => {
      const rows = await db.select({ project: projects, service: services, listing: appListings, role: memberships.role })
        .from(projects).leftJoin(services, eq(services.projectId, projects.id)).leftJoin(appListings, eq(appListings.projectId, projects.id))
        .leftJoin(memberships, and(eq(memberships.projectId, projects.id), eq(memberships.userId, actor.userId)))
        .where(and(eq(projects.kind, 'DigitalWorker'), visibleTo(actor),
          query.projectId ? eq(projects.id, query.projectId) : undefined, query.after ? gt(projects.id, query.after) : undefined,
          query.q ? sql`position(lower(${query.q}) in lower(${projects.name} || ' ' || coalesce(${appListings.description}, ''))) > 0` : undefined,
        )).orderBy(projects.id).limit(query.limit);
      return rows.map(toVisibleApplication);
    },
  };
}

function toVisibleApplication(row: { project: typeof projects.$inferSelect; service: typeof services.$inferSelect | null; listing: typeof appListings.$inferSelect | null; role: string | null }): VisibleApplication {
  const p = row.project, s = row.service;
  return {
    project: { ...p, initialPlan: p.initialPlan ?? undefined, id: p.id as ProjectId, kind: 'DigitalWorker', state: p.state as ProjectState, ownerUserId: p.ownerUserId as UserId, createdBy: p.createdBy as UserId, ...(p.message ? { message: p.message } : { message: undefined }) },
    service: s ? { ...s, id: s.id as ServiceId, projectId: s.projectId as ProjectId, kind: 'DigitalWorker' } : undefined,
    listing: row.listing ? asListing(row.listing) : defaultAppListing(p.id as ProjectId), role: row.role as MemberRole | undefined ?? undefined,
  };
}
