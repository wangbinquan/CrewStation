import { randomUUID } from 'node:crypto';
import type { Database } from '@crewstation/persistence';
import { enqueueJob } from '@crewstation/queue';
import { conflict, notFound } from '@crewstation/kernel';
import { and, desc, eq, lt, lte, sql } from 'drizzle-orm';
import type { ClusterRepository } from '../../ports/repository';
import { snapshots, inspections, operations, refreshes } from './tables';
export const CLUSTER_REFRESH = 'cluster-management.refresh';
export const CLUSTER_OPERATION = 'cluster-management.operation';
export function drizzleClusterRepository(db: Database): ClusterRepository {
  return {
    latest: async () => (await db.select().from(snapshots).orderBy(desc(snapshots.sequence)).limit(1))[0]?.body,
    snapshot: async (id) => (await db.select().from(snapshots).where(eq(snapshots.id, id)))[0]?.body,
    saveSnapshot: async (snapshot) => { await db.transaction(async (tx) => { await tx.insert(snapshots).values({ id: snapshot.id, createdAt: new Date(snapshot.finishedAt), body: snapshot }); await tx.delete(snapshots).where(lt(snapshots.createdAt, new Date(Date.parse(snapshot.finishedAt) - 600_000))); await tx.delete(inspections).where(and(lt(inspections.createdAt, new Date(Date.parse(snapshot.finishedAt) - 86_400_000)), sql`NOT EXISTS (SELECT 1 FROM cluster_management.operations o WHERE o.body->>'inspectionId' = ${inspections.id})`)); }); },
    requestRefresh: async () => db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('cluster-management.refresh'))`);
      const old = (await tx.select().from(refreshes).where(eq(refreshes.id, 'current')).for('update'))[0];
      if (old?.state === 'pending' && Date.now() - old.requestedAt.getTime() < 600_000) return old.requestId;
      const requestId = randomUUID(), value = { id: 'current', requestId, requestedAt: new Date(), state: 'pending' };
      await tx.insert(refreshes).values(value).onConflictDoUpdate({ target: refreshes.id, set: value });
      await enqueueJob(tx, CLUSTER_REFRESH, { requestId }, { dedupKey: requestId, maxAttempts: 100 });
      return requestId;
    }),
    finishRefresh: async (id) => { await db.update(refreshes).set({ state: 'done' }).where(and(eq(refreshes.id, 'current'), eq(refreshes.requestId, id))); },
    saveInspection: async ({ actorId, inspection }) => { await db.insert(inspections).values({ id: inspection.inspectionId, actorId, body: inspection, createdAt: new Date() }); },
    inspection: async (id) => { const row = (await db.select().from(inspections).where(eq(inspections.id, id)))[0]; return row ? { actorId: row.actorId, inspection: row.body } : undefined; },
    accept: async (operation, requestHash) => db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`${operation.actorId}:${operation.idempotencyKey}`}))`);
      const old = (await tx.select().from(operations).where(and(eq(operations.actorId, operation.actorId), eq(operations.key, operation.idempotencyKey))))[0];
      if (old) { if (old.requestHash !== requestHash) throw conflict('同一幂等键不能用于不同操作'); return old.body; }
      await tx.insert(operations).values({ id: operation.operationId, actorId: operation.actorId, key: operation.idempotencyKey, requestHash, createdAt: new Date(operation.createdAt), body: operation });
      await enqueueJob(tx, CLUSTER_OPERATION, { operationId: operation.operationId }, { dedupKey: operation.operationId, maxAttempts: 100 });
      return operation;
    }),
    reconcile: async (id, now) => db.transaction(async (tx) => {
      const row = (await tx.select().from(operations).where(eq(operations.id, id)).for('update'))[0];
      if (!row) throw notFound('操作', id);
      if (row.body.phase !== 'needs-attention') return row.body;
      const resumeCount = (row.body.resumeCount ?? 0) + 1;
      const body = { ...row.body, resumeCount, phase: row.body.resumePhase ?? 'observing' as const, observationStartedAt: now.toISOString(), updatedAt: now.toISOString(), httpStatus: 202, reason: '已受理继续核对，将复用原操作意图' };
      delete body.finishedAt;
      await tx.update(operations).set({ body, fence: resumeCount * 1_000_000 }).where(eq(operations.id, id));
      await enqueueJob(tx, CLUSTER_OPERATION, { operationId: id, resumeCount }, { dedupKey: `${id}:${resumeCount}`, maxAttempts: 100 });
      return body;
    }),
    operation: async (id) => (await db.select().from(operations).where(eq(operations.id, id)))[0]?.body,
    operations: async (query, actorId) => (await db.select().from(operations).where(and(query.phase ? sql`${operations.body}->>'phase' = ${query.phase}` : undefined, query.uid ? sql`${operations.body}->'target'->>'uid' = ${query.uid}` : undefined, query.projectId ? sql`${operations.body}->'target'->'ownership'->>'projectId' = ${query.projectId}` : undefined, query.idempotencyKey ? and(eq(operations.actorId, actorId), eq(operations.key, query.idempotencyKey)) : undefined)).orderBy(desc(operations.createdAt)).limit(query.limit)).map((r) => r.body),
    update: async (operation, fence) => (await db.update(operations).set({ body: operation, fence }).where(and(eq(operations.id, operation.operationId), lte(operations.fence, fence))).returning({ id: operations.id })).length === 1,
  };
}
