import type { AppAccessRequestState, ProjectId, UserId } from '@crewstation/contracts';
import type { Executor } from '@crewstation/persistence';
import { and, desc, eq, lt, or, sql } from 'drizzle-orm';
import { text, timestamp } from 'drizzle-orm/pg-core';
import type { AccessRequest } from '../../domain/accessRequest';
import type { AccessRequestRepository } from '../../ports/accessRequests';
import { projectSchema } from './schema';

export const accessRequests = projectSchema.table('app_access_requests', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull(),
  requestedBy: text('requested_by').notNull(),
  state: text('state').notNull(),
  reason: text('reason'),
  decidedBy: text('decided_by'),
  decision: text('decision'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  decidedAt: timestamp('decided_at', { withTimezone: true }),
});

export function drizzleAccessRequests(db: Executor): AccessRequestRepository {
  return {
    insert: async (request) => (await db.insert(accessRequests).values(toRow(request))
      .onConflictDoNothing({ target: [accessRequests.projectId, accessRequests.requestedBy], where: sql`state = 'pending'` })
      .returning({ id: accessRequests.id })).length > 0,
    decide: async (request) => (await db.update(accessRequests)
      .set({ state: request.state, decidedBy: request.decidedBy ?? null, decision: request.decision ?? null, decidedAt: request.decidedAt ?? null })
      .where(and(eq(accessRequests.id, request.id), eq(accessRequests.state, 'pending'))).returning({ id: accessRequests.id })).length > 0,
    getById: async (id) => {
      const row = (await db.select().from(accessRequests).where(eq(accessRequests.id, id)))[0];
      return row ? toRequest(row) : undefined;
    },
    latest: async (projectId, userId) => {
      const row = (await db.select().from(accessRequests).where(and(eq(accessRequests.projectId, projectId), eq(accessRequests.requestedBy, userId)))
        .orderBy(desc(accessRequests.createdAt), desc(accessRequests.id)).limit(1))[0];
      return row ? toRequest(row) : undefined;
    },
    listPage: async (q) => (await db.select().from(accessRequests).where(and(
      q.projectId ? eq(accessRequests.projectId, q.projectId) : undefined, q.state === 'all' ? undefined : eq(accessRequests.state, q.state),
      q.before ? or(lt(accessRequests.createdAt, q.before.createdAt), and(eq(accessRequests.createdAt, q.before.createdAt), lt(accessRequests.id, q.before.id))) : undefined,
    )).orderBy(desc(accessRequests.createdAt), desc(accessRequests.id)).limit(q.limit)).map(toRequest),
  };
}

function toRequest(row: typeof accessRequests.$inferSelect): AccessRequest {
  return {
    id: row.id, projectId: row.projectId as ProjectId, requestedBy: row.requestedBy as UserId, state: row.state as AppAccessRequestState,
    ...(row.reason === null ? {} : { reason: row.reason }), ...(row.decidedBy === null ? {} : { decidedBy: row.decidedBy as UserId }),
    ...(row.decision === null ? {} : { decision: row.decision }), createdAt: row.createdAt, ...(row.decidedAt ? { decidedAt: row.decidedAt } : {}),
  };
}

function toRow(request: AccessRequest): typeof accessRequests.$inferInsert {
  return {
    id: request.id, projectId: request.projectId, requestedBy: request.requestedBy, state: request.state, reason: request.reason ?? null,
    decidedBy: request.decidedBy ?? null, decision: request.decision ?? null, createdAt: request.createdAt, decidedAt: request.decidedAt ?? null,
  };
}
