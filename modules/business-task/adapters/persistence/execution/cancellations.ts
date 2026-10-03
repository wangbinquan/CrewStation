import { and, asc, eq, lt, or, sql } from 'drizzle-orm';
import type { Database } from '@crewstation/persistence';
import type { TaskId } from '@crewstation/contracts';
import { conflict, jsonHash, newResourceId, notFound } from '@crewstation/kernel';
import type { ExecutionCancellations } from '../../../ports/executionCancellations';
import type { ExecutionCancellation } from '../../../domain/executionCancellation';
import { authorizeStoppingExecution, executionTransaction } from '../executionTransaction';
import { executionSubtasks as tasks } from './subtaskTables';
import { executionCancellations as ops } from './cancellationTables';
import { cancelAfterStop } from './cancelAfterStop';
import { cancelBeforeStart } from './cancelBeforeStart';
import { businessAdmissionOpen } from '../deletion/admission';

const view = (row: typeof ops.$inferSelect): ExecutionCancellation => ({ ...row, taskId: row.taskId as TaskId, state: row.state as ExecutionCancellation['state'] });
const ready = () => or(eq(ops.state, 'pending'), eq(ops.state, 'awaiting'), and(eq(ops.state, 'dispatching'), lt(ops.leaseUntil, sql`clock_timestamp()`)));
const terminal = (state: string) => ['succeeded', 'failed', 'cancelled'].includes(state);
export function drizzleExecutionCancellations(db: Database): ExecutionCancellations {
  return {
    request: (serviceId, taskId, subtaskId, input, authorization) => executionTransaction(db, serviceId, async (tx, now) => {
      const digest = jsonHash({ expectedAttempt: input.expectedAttempt });
      const prior = (await tx.select().from(ops).where(and(eq(ops.serviceId, serviceId), eq(ops.subtaskId, subtaskId), eq(ops.requestKey, input.requestKey))))[0];
      if (prior) { if (prior.requestDigest !== digest || prior.taskId !== taskId) throw conflict('取消幂等键参数不同', { code: 'idempotency_conflict' }); return view(prior); }
      const subtask = (await tx.select().from(tasks).where(and(eq(tasks.serviceId, serviceId), eq(tasks.taskId, taskId), eq(tasks.id, subtaskId))).for('update'))[0];
      if (!subtask) throw notFound('业务子任务', subtaskId);
      if (subtask.view.attempt !== input.expectedAttempt) throw conflict('子任务 attempt 已变化', { code: 'stale_generation' });
      const epoch = await authorizeStoppingExecution(tx, serviceId, subtask.fenced, authorization, now);
      const done = terminal(subtask.view.state);
      if (!done) {
        if (!subtask.incarnation && !subtask.runtimeDispatched) await cancelBeforeStart(tx, subtask, now);
        else await tx.update(tasks).set({ view: { ...subtask.view, state: 'cancelling', cancelRequestedAt: subtask.view.cancelRequestedAt ?? now.toISOString() } }).where(eq(tasks.id, subtaskId));
      }
      const row = (await tx.insert(ops).values({ id: newResourceId(), serviceId, taskId, subtaskId, requestKey: input.requestKey, requestDigest: digest,
        expectedAttempt: input.expectedAttempt, epoch, state: done || (!subtask.incarnation && !subtask.runtimeDispatched) ? 'succeeded' : 'pending', updatedAt: now }).returning())[0]!;
      return view(row);
    }),
    finishBeforeStart: (operation) => executionTransaction(db, operation.serviceId, async (tx, now) => {
      const subtask = (await tx.select().from(tasks).where(eq(tasks.id, operation.subtaskId)).for('update'))[0];
      if (!subtask || subtask.incarnation || !subtask.view.cancelRequestedAt) return false;
      if (!terminal(subtask.view.state)) await cancelBeforeStart(tx, subtask, now);
      return true;
    }),
    finishStopped: (operation) => executionTransaction(db, operation.serviceId, async (tx, now) => {
      const subtask = (await tx.select().from(tasks).where(and(eq(tasks.id, operation.subtaskId), eq(tasks.serviceId, operation.serviceId), eq(tasks.taskId, operation.taskId))).for('update'))[0];
      if (!subtask || subtask.view.attempt !== operation.expectedAttempt || !subtask.view.cancelRequestedAt) return false;
      if (!terminal(subtask.view.state)) await cancelAfterStop(tx, subtask, now);
      return true;
    }),
    get: async (id) => { const row = (await db.select().from(ops).where(eq(ops.id, id)))[0]; return row && view(row); },
    claim: (owner, id) => db.transaction(async (tx) => {
      const row = (await tx.select().from(ops).where(and(businessAdmissionOpen(ops.serviceId), ready(), id ? eq(ops.id, id) : undefined)).orderBy(asc(ops.updatedAt)).limit(1).for('update', { skipLocked: true }))[0];
      if (!row) return undefined;
      const updated = (await tx.update(ops).set({ state: 'dispatching', owner, revision: row.revision + 1, leaseUntil: sql`clock_timestamp() + interval '30 seconds'`, updatedAt: sql`clock_timestamp()` }).where(eq(ops.id, row.id)).returning())[0]!;
      return view(updated);
    }),
    settle: (operation, state, errorCode) => db.transaction(async (tx) => (await tx.update(ops).set({ state, errorCode: errorCode ?? null, owner: null, leaseUntil: null, updatedAt: sql`clock_timestamp()` }).where(and(eq(ops.id, operation.id), eq(ops.revision, operation.revision), eq(ops.owner, operation.owner!), eq(ops.state, 'dispatching'), sql`${ops.leaseUntil} > clock_timestamp()`)).returning()).length === 1),
  };
}
