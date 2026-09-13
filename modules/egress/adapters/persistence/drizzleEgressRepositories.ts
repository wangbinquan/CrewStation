import type { EgressRequestState, EgressScope, EgressSource, ProjectId, UserId } from '@crewstation/contracts';
import type { Executor } from '@crewstation/persistence';
import { and, desc, eq, lt, or } from 'drizzle-orm';
import type { BlockedRecord } from '../../domain/blockedRecord';
import type { EgressEntry } from '../../domain/egressEntry';
import type { EgressRequest } from '../../domain/egressRequest';
import type { BlockedRecordRepository, EgressEntryRepository, EgressRequestRepository } from '../../ports/repositories';
import { blocked, entries, requests } from './tables';

export function drizzleEgressEntryRepository(db: Executor): EgressEntryRepository {
  const first = (rows: Array<typeof entries.$inferSelect>): EgressEntry | undefined => (rows[0] ? toEntry(rows[0]) : undefined);
  return {
    insert: async (entry) => {
      await db.insert(entries).values({ id: entry.id, fqdn: entry.fqdn, scope: entry.scope, projectId: entry.projectId ?? '', note: entry.note ?? null, createdBy: entry.createdBy, createdAt: entry.createdAt });
    },
    getById: (id) => db.select().from(entries).where(eq(entries.id, id)).then(first),
    remove: async (id) => { await db.delete(entries).where(eq(entries.id, id)); },
    listAll: async () => (await db.select().from(entries).orderBy(entries.scope, entries.fqdn)).map(toEntry),
    listEffective: async (projectId) => (await db.select().from(entries).where(or(eq(entries.scope, 'global'), eq(entries.projectId, projectId))).orderBy(entries.scope, entries.fqdn)).map(toEntry),
    find: (fqdn, scope, projectId) => db.select().from(entries).where(and(eq(entries.fqdn, fqdn), eq(entries.scope, scope), eq(entries.projectId, projectId ?? ''))).then(first),
  };
}

export function drizzleEgressRequestRepository(db: Executor): EgressRequestRepository {
  const first = (rows: Array<typeof requests.$inferSelect>): EgressRequest | undefined => (rows[0] ? toRequest(rows[0]) : undefined);
  return {
    insert: async (request) => { await db.insert(requests).values(toRequestRow(request)); },
    update: async (request) => { await db.update(requests).set(toRequestRow(request)).where(eq(requests.id, request.id)); },
    getById: (id) => db.select().from(requests).where(eq(requests.id, id)).then(first),
    list: async (projectId) => {
      const rows = projectId === undefined
        ? await db.select().from(requests).orderBy(requests.createdAt, requests.id)
        : await db.select().from(requests).where(eq(requests.projectId, projectId)).orderBy(requests.createdAt, requests.id);
      return rows.map(toRequest);
    },
    listPage: async (q) => (await db.select().from(requests).where(and(
      q.projectId ? eq(requests.projectId, q.projectId) : undefined, q.state === 'all' ? undefined : eq(requests.state, q.state),
      q.before ? or(lt(requests.createdAt, q.before.createdAt), and(eq(requests.createdAt, q.before.createdAt), lt(requests.id, q.before.id))) : undefined,
    )).orderBy(desc(requests.createdAt), desc(requests.id)).limit(q.limit)).map(toRequest),
    findPending: (projectId, fqdn) => db.select().from(requests).where(and(eq(requests.projectId, projectId), eq(requests.fqdn, fqdn), eq(requests.state, 'pending'))).then(first),
  };
}

export function drizzleBlockedRecordRepository(db: Executor): BlockedRecordRepository {
  return {
    get: async (projectId, fqdn) => {
      const row = (await db.select().from(blocked).where(and(eq(blocked.projectId, projectId), eq(blocked.fqdn, fqdn))))[0];
      return row ? toBlocked(row) : undefined;
    },
    upsert: async (record) => {
      const row = { projectId: record.projectId, fqdn: record.fqdn, count: record.count, lastSeenAt: record.lastSeenAt, source: record.source ?? null };
      await db.insert(blocked).values(row).onConflictDoUpdate({ target: [blocked.projectId, blocked.fqdn], set: { count: row.count, lastSeenAt: row.lastSeenAt, source: row.source } });
    },
    listByProject: async (projectId) => (await db.select().from(blocked).where(eq(blocked.projectId, projectId)).orderBy(blocked.lastSeenAt)).map(toBlocked),
  };
}

function toEntry(row: typeof entries.$inferSelect): EgressEntry {
  return {
    id: row.id, fqdn: row.fqdn, scope: row.scope as EgressScope, createdBy: row.createdBy as UserId, createdAt: row.createdAt,
    ...(row.projectId ? { projectId: row.projectId as ProjectId } : {}),
    ...(row.note ? { note: row.note } : {}),
  };
}

function toRequest(row: typeof requests.$inferSelect): EgressRequest {
  return {
    id: row.id, projectId: row.projectId as ProjectId, fqdn: row.fqdn, state: row.state as EgressRequestState, requestedBy: row.requestedBy as UserId, createdAt: row.createdAt,
    ...(row.reason ? { reason: row.reason } : {}),
    ...(row.decidedBy ? { decidedBy: row.decidedBy as UserId } : {}),
    ...(row.decision ? { decision: row.decision } : {}),
    ...(row.decidedAt ? { decidedAt: row.decidedAt } : {}),
  };
}

function toRequestRow(request: EgressRequest): typeof requests.$inferInsert {
  return { ...request, reason: request.reason ?? null, decidedBy: request.decidedBy ?? null, decision: request.decision ?? null, decidedAt: request.decidedAt ?? null };
}

function toBlocked(row: typeof blocked.$inferSelect): BlockedRecord {
  return { projectId: row.projectId as ProjectId, fqdn: row.fqdn, count: row.count, lastSeenAt: row.lastSeenAt, ...(row.source ? { source: row.source as EgressSource } : {}) };
}
