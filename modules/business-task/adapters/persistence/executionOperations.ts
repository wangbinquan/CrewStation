import { and, eq, sql } from 'drizzle-orm';
import { notFound } from '@crewstation/kernel';
import type { Database } from '@crewstation/persistence';
import type { ExecutionOperations } from '../../ports/executionOperations';
import { executionOperations as ops } from './executionTables';
import { authorizeExecution, executionTransaction } from './executionTransaction';
import { claimExecutionOperation } from './executionOperationClaims';
import { authorizeRestart } from './recovery/restartAdmission';
import { bindRecoveryMutation } from './recovery/mutations';
import { leaseSeconds as seconds, operationKeyed as keyed, operationLeased as leased, toOperation, verifyOperationDigest as verifyDigest } from './operationRows';

/** 同一表承载幂等回执与 outbox；数据库时钟和 CAS 拒绝过期 worker 的迟到回执。 */
export function drizzleExecutionOperations(db: Database): ExecutionOperations {
  return {
    find: async (key) => { const row = (await db.select().from(ops).where(keyed(key)))[0]; return row ? toOperation(row) : undefined; },
    get: async (id) => { const row = (await db.select().from(ops).where(eq(ops.id, id)))[0]; return row ? toOperation(row) : undefined; },
    forTask: async (serviceId, taskId) => { const row = (await db.select().from(ops).where(and(eq(ops.serviceId, serviceId), eq(ops.kind, 'create-task'), sql`${ops.intent}->'task'->>'id' = ${taskId}`)))[0]; return row ? toOperation(row) : undefined; },
    reserve: (candidate, authorization) => executionTransaction(db, candidate.serviceId, async (tx, now) => {
      const old = (await tx.select().from(ops).where(keyed(candidate)))[0];
      if (old) { const operation = toOperation(old); verifyDigest(operation, candidate.requestDigest); return { operation, created: false }; }
      const recovery = await authorizeRestart(tx, now, candidate, authorization);
      const epoch = await authorizeExecution(tx, candidate.serviceId, candidate.intent.tasksSpec.executionControl === 'fenced', authorization, now);
      const rows = await tx.insert(ops).values({ ...candidate, epoch, state: 'pending', createdAt: sql`clock_timestamp()`, updatedAt: sql`clock_timestamp()` })
        .onConflictDoNothing({ target: [ops.serviceId, ops.kind, ops.parentId, ops.requestKey] }).returning();
      const row = rows[0] ?? (await tx.select().from(ops).where(keyed(candidate)))[0]!;
      const operation = toOperation(row);
      verifyDigest(operation, candidate.requestDigest);
      await bindRecoveryMutation(tx, now, recovery, { operationId: operation.id, resultTaskId: operation.intent.task.id });
      return { operation, created: rows.length === 1 };
    }),
    claim: (input) => claimExecutionOperation(db, input),
    renew: (lease, leaseSeconds) => db.transaction(async (tx) => (await tx.update(ops).set({ leaseUntil: sql`clock_timestamp() + ${seconds(leaseSeconds)} * interval '1 second'`, updatedAt: sql`clock_timestamp()` }).where(leased(lease)).returning({ id: ops.id })).length === 1),
    settle: (lease, state, errorCode) => db.transaction(async (tx) => (await tx.update(ops).set({ state, errorCode: errorCode ?? null, leaseOwner: null, leaseUntil: null, updatedAt: sql`clock_timestamp()` }).where(leased(lease)).returning({ id: ops.id })).length === 1),
    retryRejected: (key, digest, authorization) => executionTransaction(db, key.serviceId, async (tx, now) => {
      const row = (await tx.select().from(ops).where(keyed(key)).for('update'))[0];
      if (!row) throw notFound('业务执行操作');
      const operation = toOperation(row); verifyDigest(operation, digest);
      if (operation.state !== 'retryable-rejected') return operation;
      const recovery = await authorizeRestart(tx, now, operation, authorization);
      const epoch = await authorizeExecution(tx, key.serviceId, operation.intent.tasksSpec.executionControl === 'fenced', authorization, now);
      const resumed = (await tx.update(ops).set({ state: 'pending', epoch, errorCode: null, updatedAt: sql`clock_timestamp()` }).where(eq(ops.id, row.id)).returning())[0]!;
      await bindRecoveryMutation(tx, now, recovery, { operationId: operation.id, resultTaskId: operation.intent.task.id });
      return toOperation(resumed);
    }),
    adoptPending: (key, digest, authorization) => executionTransaction(db, key.serviceId, async (tx, now) => {
      const row = (await tx.select().from(ops).where(keyed(key)).for('update'))[0];
      if (!row) throw notFound('业务执行操作');
      const operation = toOperation(row); verifyDigest(operation, digest);
      if (operation.state !== 'pending' || operation.errorCode === 'admission_unknown') return operation;
      const recovery = await authorizeRestart(tx, now, operation, authorization);
      const epoch = await authorizeExecution(tx, key.serviceId, operation.intent.tasksSpec.executionControl === 'fenced', authorization, now);
      const adopted = (await tx.update(ops).set({ epoch, updatedAt: now }).where(eq(ops.id, row.id)).returning())[0]!;
      await bindRecoveryMutation(tx, now, recovery, { operationId: operation.id, resultTaskId: operation.intent.task.id });
      return toOperation(adopted);
    }),
  };
}
