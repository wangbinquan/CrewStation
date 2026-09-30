import type { ResourceCatalogPolicy, ResourceType } from '@crewstation/contracts';
import type { Database, Transaction } from '@crewstation/persistence';
import { enqueueJob } from '@crewstation/queue';
import { conflict } from '@crewstation/kernel';
import { and, desc, eq, inArray, lt } from 'drizzle-orm';
import { IN_FLIGHT, targetKey } from '../../domain/change';
import type { ResourceChange } from '../../domain/change';
import type { ResourceAccessRepository } from '../../ports/repository';
import { resourceAccessTransaction } from './coordination';
import { catalogPolicies, changes } from './tables';

export const RESOURCE_CHANGE_JOB = 'resource-access.apply';
const policyKey = (type: ResourceType, id: string) => `${type}:${id}`;
const toPolicy = (type: ResourceType, id: string, row?: typeof catalogPolicies.$inferSelect): ResourceCatalogPolicy => ({ resourceType: type, resourceId: id, requestable: row?.requestable === 1, revision: row?.revision ?? 0, updatedAt: row?.updatedAt.toISOString() ?? null });
const schedule = (tx: Transaction, change: ResourceChange) => enqueueJob(tx, RESOURCE_CHANGE_JOB, { changeId: change.id }, { dedupKey: `${change.id}:${change.version}`, maxAttempts: 100 });

export function resourceAccessRepository(db: Database): ResourceAccessRepository {
  return {
    get: async (id) => (await db.select().from(changes).where(eq(changes.id, id)).limit(1))[0]?.body,
    byKey: async (projectId, actorId, key) => (await db.select().from(changes).where(and(eq(changes.projectId, projectId), eq(changes.actorId, actorId), eq(changes.key, key))).limit(1))[0]?.body,
    accept: (change) => resourceAccessTransaction(db, `${change.projectId}:${targetKey(change.target)}`, async (tx) => {
      const old = (await tx.select().from(changes).where(and(eq(changes.projectId, change.projectId), eq(changes.actorId, change.requestedBy), eq(changes.key, change.requestKey))).limit(1))[0];
      if (old) { if (old.body.requestHash !== change.requestHash) throw conflict('同一申请键不能用于不同内容'); return old.body; }
      const active = (await tx.select().from(changes).where(and(eq(changes.projectId, change.projectId), eq(changes.targetKey, targetKey(change.target)), inArray(changes.state, [...IN_FLIGHT]))).limit(1))[0];
      if (active) throw conflict('该资源已有未完成变更，请先处理原申请', { code: 'resource_change_inflight', requestId: active.id });
      await tx.insert(changes).values({ id: change.id, projectId: change.projectId, actorId: change.requestedBy, key: change.requestKey, targetKey: targetKey(change.target), state: change.state, version: change.version, body: change, createdAt: new Date(change.createdAt) });
      if (change.state === 'approved') await schedule(tx, change);
      return change;
    }),
    list: async (projectId, query) => {
      const rows = await db.select().from(changes).where(and(eq(changes.projectId, projectId), query.cursor ? lt(changes.id, query.cursor) : undefined, query.inFlight === 'true' ? inArray(changes.state, [...IN_FLIGHT]) : undefined)).orderBy(desc(changes.id)).limit(query.limit + 1);
      const items = rows.slice(0, query.limit).map((r) => r.body);
      return { items, nextCursor: rows.length > query.limit ? items.at(-1)!.id : null };
    },
    save: (change, expectedVersion, enqueue = false) => resourceAccessTransaction(db, change.id, async (tx) => {
      const updated = await tx.update(changes).set({ body: change, version: change.version, state: change.state }).where(and(eq(changes.id, change.id), eq(changes.version, expectedVersion))).returning({ id: changes.id });
      if (!updated.length) return false;
      if (enqueue) await schedule(tx, change);
      return true;
    }),
    policies: async () => (await db.select().from(catalogPolicies)).map((r) => toPolicy(r.resourceType as ResourceType, r.resourceId, r)),
    policy: async (type, id) => toPolicy(type, id, (await db.select().from(catalogPolicies).where(eq(catalogPolicies.key, policyKey(type, id))).limit(1))[0]),
    savePolicy: (type, id, input, actorId, now) => resourceAccessTransaction(db, policyKey(type, id), async (tx) => {
      const old = (await tx.select().from(catalogPolicies).where(eq(catalogPolicies.key, policyKey(type, id))).limit(1))[0];
      if ((old?.revision ?? 0) !== input.expectedRevision) throw conflict('目录申请政策已变化，请重新读取');
      const value = { key: policyKey(type, id), resourceType: type, resourceId: id, requestable: input.requestable ? 1 : 0, revision: input.expectedRevision + 1, actorId, updatedAt: new Date(now) };
      await tx.insert(catalogPolicies).values(value).onConflictDoUpdate({ target: catalogPolicies.key, set: value });
      return toPolicy(type, id, value);
    }),
  };
}
