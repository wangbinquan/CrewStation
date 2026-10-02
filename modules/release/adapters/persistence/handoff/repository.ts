import { and, asc, desc, eq, gt, sql } from 'drizzle-orm';
import type { Executor } from '@crewstation/persistence';
import type { HandoffRepository } from '../../../ports/executionHandoff';
import type { ExecutionHandoffOperation } from '../../../domain/executionHandoff';
import { executionHandoffs as ops } from '../tables';

const view = (row: typeof ops.$inferSelect): ExecutionHandoffOperation => ({ ...row.body, stage: row.stage as ExecutionHandoffOperation['stage'], revision: row.revision, owner: row.owner, leaseUntil: row.leaseUntil?.toISOString() ?? null, updatedAt: row.updatedAt.toISOString() });
/** Claims use database time; stale worker responses cannot advance a handoff. */
export function drizzleHandoffs(db: Executor): HandoffRepository {
  return {
    latest: async (serviceId) => { const row = (await db.select().from(ops).where(eq(ops.serviceId, serviceId)).orderBy(desc(ops.updatedAt)).limit(1))[0]; return row && view(row); },
    findByKey: async (serviceId, requestKey) => { const row = (await db.select().from(ops).where(and(eq(ops.serviceId, serviceId), eq(ops.requestKey, requestKey))))[0]; return row && view(row); },
    get: async (id) => { const row = (await db.select().from(ops).where(eq(ops.id, id)))[0]; return row && view(row); },
    active: async (serviceId) => { const row = (await db.select().from(ops).where(and(eq(ops.serviceId, serviceId), sql`${ops.stage} <> 'complete'`)))[0]; return row && view(row); },
    insert: async (operation) => { await db.insert(ops).values({ id: operation.id, requestKey: operation.requestKey, serviceId: operation.serviceId, stage: operation.stage, body: operation }); },
    pending: async (limit, afterId) => (await db.select().from(ops).where(and(
      sql`${ops.stage} <> 'complete' AND (${ops.leaseUntil} IS NULL OR ${ops.leaseUntil} < clock_timestamp())`,
      afterId === undefined ? undefined : gt(ops.id, afterId),
    )).orderBy(asc(ops.id)).limit(limit)).map(view),
    claim: async (id, owner) => {
      const row = (await db.update(ops).set({ owner, revision: sql`${ops.revision}+1`, leaseUntil: sql`clock_timestamp()+interval '30 seconds'`, updatedAt: sql`clock_timestamp()` })
        .where(and(eq(ops.id, id), sql`${ops.stage} <> 'complete' AND (${ops.leaseUntil} IS NULL OR ${ops.leaseUntil} < clock_timestamp())`)).returning())[0];
      return row && view(row);
    },
    settle: async (claim, update) => (await db.update(ops).set({ stage: update.stage, body: { ...claim, message: undefined, ...update }, owner: null, leaseUntil: null, updatedAt: sql`clock_timestamp()` })
      .where(and(eq(ops.id, claim.id), eq(ops.revision, claim.revision), eq(ops.owner, claim.owner!), sql`${ops.leaseUntil} > clock_timestamp()`)).returning()).length === 1,
  };
}
