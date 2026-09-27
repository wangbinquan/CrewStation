import { reserveSessionHome, releaseSessionHome } from '../sessions/repository';
import { assertTaskAcceptsExecution } from './lifecycleAdmission';
import { and, asc, eq, lt, or, sql } from 'drizzle-orm';
import { conflict, notFound } from '@crewstation/kernel';
import type { Database, Executor } from '@crewstation/persistence';
import type { TaskId } from '@crewstation/contracts';
import type { ExecutionSubtask } from '../../../domain/executionSubtask';
import type { ExecutionSubtasks, SubtaskCandidate } from '../../../ports/executionSubtasks';
import { liveControl } from '../../../domain/executionControl';
import { authorizeExecution, executionTransaction, readExecutionControl } from '../executionTransaction';
import { executionSubtasks as tasks } from './subtaskTables';

const scope = (serviceId: string, taskId: TaskId) => and(eq(tasks.serviceId, serviceId), eq(tasks.taskId, taskId));
const rowView = (row: typeof tasks.$inferSelect): ExecutionSubtask => ({ ...row, taskId: row.taskId as TaskId, requestKind: row.requestKind as ExecutionSubtask['requestKind'], dispatch: row.dispatch as ExecutionSubtask['dispatch'], leaseUntil: row.leaseUntil?.toISOString() ?? null });
const leased = (claim: ExecutionSubtask) => and(eq(tasks.id, claim.view.id), eq(tasks.revision, claim.revision), eq(tasks.owner, claim.owner!), eq(tasks.dispatch, 'dispatching'), sql`${tasks.leaseUntil} > clock_timestamp()`);
const ready = () => or(eq(tasks.dispatch, 'pending'), eq(tasks.dispatch, 'unknown'), and(eq(tasks.dispatch, 'dispatching'), lt(tasks.leaseUntil, sql`clock_timestamp()`)));

/** One versioned journal for request identity, immutable input, and dispatch ownership. */
export function drizzleExecutionSubtasks(db: Database): ExecutionSubtasks {
  return {
    checkpointRuntime: async (claim) => (await db.update(tasks).set({ runtimeDispatched: true }).where(and(leased(claim), sql`NOT (${tasks.view} ? 'cancelRequestedAt')`)).returning()).length === 1,
    markRuntimeReleased: (subtask) => executionTransaction(db, subtask.serviceId, async (tx) => { const rows = await tx.update(tasks).set({ runtimeReleased: true }).where(and(eq(tasks.id, subtask.view.id), sql`${tasks.view}->>'state' IN ('succeeded','failed','cancelled')`)).returning(); if (rows.length) await releaseSessionHome(tx, rowView(rows[0]!)); }),
    cleanupCandidates: async (limit) => (await db.select().from(tasks).where(sql`${tasks.runtimeTaskId} IS NOT NULL AND ${tasks.runtimeReleased} = false AND ${tasks.view}->>'state' IN ('succeeded','failed','cancelled') AND NOT EXISTS (SELECT 1 FROM business_task.execution_messages m WHERE m.subtask_id=${tasks.id} AND m.state NOT IN ('succeeded','failed'))`).orderBy(asc(tasks.updatedAt)).limit(limit)).map(rowView),
    forExecution: async (serviceId, taskId, executionId) => { const row = (await db.select().from(tasks).where(and(scope(serviceId, taskId), sql`${tasks.view}->>'executionId' = ${executionId}`)))[0]; return row && rowView(row); },
    find: async (serviceId, taskId, key, kind = 'submit', parent = '') => { const row = (await db.select().from(tasks).where(and(scope(serviceId, taskId), eq(tasks.requestKey, key), eq(tasks.requestKind, kind), eq(tasks.requestParent, parent))))[0]; return row && rowView(row); },
    get: async (serviceId, taskId, id) => { const row = (await db.select().from(tasks).where(and(scope(serviceId, taskId), eq(tasks.id, id))))[0]; return row && rowView(row); },
    list: async (serviceId, taskId) => (await db.select().from(tasks).where(scope(serviceId, taskId)).orderBy(asc(tasks.id))).map(rowView),
    reserve: (candidate, authorization) => executionTransaction(db, candidate.serviceId, async (tx, now) => {
      const old = (await tx.select().from(tasks).where(and(scope(candidate.serviceId, candidate.taskId), eq(tasks.requestKey, candidate.requestKey), eq(tasks.requestKind, candidate.requestKind), eq(tasks.requestParent, candidate.requestParent))))[0];
      if (old) {
        if (old.requestDigest !== candidate.requestDigest) throw conflict('同一 requestKey 已用于不同子任务参数', { code: 'idempotency_conflict' });
        return { subtask: rowView(old), created: false };
      }
      await assertTaskAcceptsExecution(tx, candidate.taskId);
      if (candidate.requestKind === 'retry') await assertRetry(tx, candidate);
      const epoch = await authorizeExecution(tx, candidate.serviceId, candidate.fenced, authorization, now);
      await reserveSessionHome(tx, candidate);
      const row = (await tx.insert(tasks).values({ ...candidate, id: candidate.view.id, epoch, dispatch: 'pending', updatedAt: now }).returning())[0]!;
      return { subtask: rowView(row), created: true };
    }),
    adoptPending: (subtask, authorization) => executionTransaction(db, subtask.serviceId, async (tx, now) => {
      const row = (await tx.select().from(tasks).where(and(scope(subtask.serviceId, subtask.taskId), eq(tasks.id, subtask.view.id))).for('update'))[0];
      if (!row) throw notFound('业务子任务', subtask.view.id);
      if (!['pending', 'retryable-rejected'].includes(row.dispatch) || row.incarnation || row.view.cancelRequestedAt) return rowView(row);
      const epoch = await authorizeExecution(tx, row.serviceId, row.fenced, authorization, now);
      const updated = (await tx.update(tasks).set({ epoch, dispatch: 'pending', updatedAt: now }).where(eq(tasks.id, row.id)).returning())[0]!;
      return rowView(updated);
    }),
    claim: (owner, id) => claimSubtask(db, owner, id),
    checkpoint: (claim, incarnation) => executionTransaction(db, claim.serviceId, async (tx, now) => {
      if (!claim.incarnation) {
        const control = await readExecutionControl(tx, claim.serviceId);
        if ((control || claim.fenced) && (!control || control.phase !== 'active' || !liveControl(control, now) || control.epoch !== claim.epoch || (control.handoff && control.handoff.stage !== 'complete'))) return false;
      }
      return (await tx.update(tasks).set({ incarnation, updatedAt: now }).where(and(leased(claim), sql`NOT (${tasks.view} ? 'cancelRequestedAt')`, or(sql`${tasks.incarnation} IS NULL`, eq(tasks.incarnation, incarnation)))).returning()).length === 1;
    }),
    settle: async (claim, update) => (await db.update(tasks).set({ ...update, view: sql`CASE WHEN ${tasks.view} ? 'result' THEN ${tasks.view} WHEN ${tasks.view} ? 'cancelRequestedAt' THEN ${JSON.stringify(update.view)}::jsonb || jsonb_build_object('cancelRequestedAt', ${tasks.view}->'cancelRequestedAt', 'state', 'cancelling') ELSE ${JSON.stringify(update.view)}::jsonb END`,
      dispatch: sql`CASE WHEN ${tasks.view} ? 'result' THEN 'accepted' ELSE ${update.dispatch} END`,
      ...(update.receipt ? { receipt: sql`CASE WHEN ${tasks.view} ? 'result' THEN ${tasks.receipt} ELSE ${JSON.stringify(update.receipt)}::jsonb END` } : {}),
      owner: null, leaseUntil: null, updatedAt: sql`clock_timestamp()` }).where(leased(claim)).returning()).length === 1,
  };
}
async function claimSubtask(db: Database, owner: string, id?: string): Promise<ExecutionSubtask | undefined> {
  const candidates = await db.select({ id: tasks.id, serviceId: tasks.serviceId }).from(tasks).where(and(ready(), id ? eq(tasks.id, id) : undefined)).orderBy(asc(tasks.updatedAt), asc(tasks.id)).limit(100);
  for (const candidate of candidates) {
    const claimed = await executionTransaction(db, candidate.serviceId, async (tx, now) => {
      const row = (await tx.select().from(tasks).where(and(eq(tasks.id, candidate.id), ready())).for('update', { skipLocked: true }))[0];
      if (!row) return undefined;
      // Once an incarnation is persisted, reconciliation remains legal after freeze. It cannot choose a new execution.
      if (!row.incarnation && !(row.runtimeDispatched && !row.runtimeAdmitted)) {
        const control = await readExecutionControl(tx, row.serviceId);
        if (control || row.epoch !== null) {
          if (!control || control.phase !== 'active' || !liveControl(control, now) || control.epoch !== row.epoch || (control.handoff && control.handoff.stage !== 'complete')) {
            if (row.dispatch !== 'pending') await tx.update(tasks).set({ dispatch: 'pending', owner: null, leaseUntil: null, updatedAt: now }).where(eq(tasks.id, row.id));
            return undefined;
          }
        }
      }
      const updated = (await tx.update(tasks).set({ dispatch: 'dispatching', owner, leaseUntil: new Date(now.getTime() + 30_000), revision: row.revision + 1, updatedAt: now }).where(eq(tasks.id, row.id)).returning())[0]!;
      return rowView(updated);
    });
    if (claimed) return claimed;
  }
  return undefined;
}

async function assertRetry(tx: Executor, candidate: SubtaskCandidate): Promise<void> {
  const prior = (await tx.select().from(tasks).where(and(scope(candidate.serviceId, candidate.taskId), eq(tasks.id, candidate.requestParent))).for('update'))[0];
  if (!prior || !['succeeded', 'failed', 'cancelled'].includes(prior.view.state) || prior.view.attempt + 1 !== candidate.view.attempt || candidate.view.previousId !== prior.id) throw conflict('只有已终结且 attempt 匹配的子任务可以重试', { code: 'stale_generation' });
  if ((await tx.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.requestKind, 'retry'), eq(tasks.requestParent, prior.id))).limit(1)).length) throw conflict('该 attempt 已有后继重试', { code: 'stale_generation' });
}
