import type { ApiRequestState, ProjectId, ServiceId, UserId } from '@crewstation/contracts';
import type { Executor } from '@crewstation/persistence';
import { and, desc, eq } from 'drizzle-orm';
import type { ApiGrant, GrantState } from '../../domain/apiGrant';
import type { ApiRequest } from '../../domain/apiRequest';
import type { ApiGrantRepository, ApiRequestRepository } from '../../ports/repositories';
import { grants, requests } from './tables';

export function drizzleGrantRepository(db: Executor): ApiGrantRepository {
  return {
    get: async (serviceId, operationKey) => {
      const row = (await db.select().from(grants).where(and(eq(grants.serviceId, serviceId), eq(grants.operationKey, operationKey))))[0];
      return row ? toGrant(row) : undefined;
    },
    listGranted: async (serviceId) => (await db.select().from(grants).where(and(eq(grants.serviceId, serviceId), eq(grants.state, 'granted'))).orderBy(grants.operationKey)).map(toGrant),
    upsert: async (grant) => {
      const row = toGrantRow(grant);
      await db.insert(grants).values(row).onConflictDoUpdate({ target: [grants.serviceId, grants.operationKey], set: row });
    },
  };
}

export function drizzleRequestRepository(db: Executor): ApiRequestRepository {
  return {
    insert: async (request) => { await db.insert(requests).values(toRequestRow(request)); },
    update: async (request) => { await db.update(requests).set(toRequestRow(request)).where(eq(requests.id, request.id)); },
    getById: async (id) => {
      const row = (await db.select().from(requests).where(eq(requests.id, id)))[0];
      return row ? toRequest(row) : undefined;
    },
    findPending: async (serviceId, operationKey) => {
      const row = (await db.select().from(requests).where(and(eq(requests.serviceId, serviceId), eq(requests.operationKey, operationKey), eq(requests.state, 'pending'))))[0];
      return row ? toRequest(row) : undefined;
    },
    list: async (projectId) => {
      const query = db.select().from(requests).orderBy(desc(requests.createdAt));
      const rows = projectId === undefined ? await query : await query.where(eq(requests.projectId, projectId));
      return rows.map(toRequest);
    },
  };
}

function toGrant(row: typeof grants.$inferSelect): ApiGrant {
  return {
    serviceId: row.serviceId as ServiceId, operationKey: row.operationKey, state: row.state as GrantState,
    grantedBy: row.grantedBy as UserId, grantedAt: row.grantedAt, ...(row.revokedAt ? { revokedAt: row.revokedAt } : {}),
  };
}

function toGrantRow(grant: ApiGrant): typeof grants.$inferInsert {
  return { serviceId: grant.serviceId, operationKey: grant.operationKey, state: grant.state, grantedBy: grant.grantedBy, grantedAt: grant.grantedAt, revokedAt: grant.revokedAt ?? null };
}

function toRequest(row: typeof requests.$inferSelect): ApiRequest {
  return {
    id: row.id, serviceId: row.serviceId as ServiceId, projectId: row.projectId as ProjectId, operationKey: row.operationKey,
    state: row.state as ApiRequestState, ...(row.reason === null ? {} : { reason: row.reason }), requestedBy: row.requestedBy as UserId,
    ...(row.decidedBy === null ? {} : { decidedBy: row.decidedBy as UserId }), ...(row.decision === null ? {} : { decision: row.decision }),
    createdAt: row.createdAt, ...(row.decidedAt ? { decidedAt: row.decidedAt } : {}),
  };
}

function toRequestRow(request: ApiRequest): typeof requests.$inferInsert {
  return {
    id: request.id, serviceId: request.serviceId, projectId: request.projectId, operationKey: request.operationKey, state: request.state,
    reason: request.reason ?? null, requestedBy: request.requestedBy, decidedBy: request.decidedBy ?? null, decision: request.decision ?? null,
    createdAt: request.createdAt, decidedAt: request.decidedAt ?? null,
  };
}
