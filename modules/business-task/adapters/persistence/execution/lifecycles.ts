import { appendTaskState } from './logEvents';
import { and, asc, eq, lt, or, sql } from 'drizzle-orm';
import type { Database } from '@crewstation/persistence';
import type { ExecutionLifecycles } from '../../../ports/executionLifecycle';
import type { ExecutionTaskState } from '../../../domain/executionLifecycle';
import { liveControl } from '../../../domain/executionControl';
import { executionTransaction, readExecutionControl } from '../executionTransaction';
import { lifecycleRow, requestLifecycle } from './lifecycleAdmission';
import { executionLifecycles as ops, executionTaskStates as tasks } from './lifecycleTables';

const ready = () => or(eq(ops.state, 'pending'), and(eq(ops.state, 'running'), lt(ops.leaseUntil, sql`clock_timestamp()`)));
export function drizzleExecutionLifecycles(db: Database): ExecutionLifecycles {
  return {
    request: requestLifecycle(db),
    read: async (serviceId, taskId) => (await db.select().from(tasks).where(and(eq(tasks.serviceId, serviceId), eq(tasks.taskId, taskId))))[0] as ExecutionTaskState | undefined,
    get: async (id) => { const row = (await db.select().from(ops).where(eq(ops.id, id)))[0]; return row && lifecycleRow(row); },
    claim: (owner, id) => claimLifecycle(db, owner, id),
    settle: (operation, state, errorCode) => executionTransaction(db, operation.serviceId, async (tx, now) => {
      const updated = await tx.update(ops).set({ state, owner: null, leaseUntil: null, updatedAt: now, errorCode: errorCode ?? null }).where(and(eq(ops.id, operation.id), eq(ops.revision, operation.revision), eq(ops.owner, operation.owner!), eq(ops.state, 'running'), sql`${ops.leaseUntil} > clock_timestamp()`)).returning();
      if (!updated.length) return false;
      if (state !== 'pending') {
        const taskState = state === 'succeeded' ? ({ pause: 'paused', resume: 'running', close: 'closed' } as const)[operation.action] : operation.priorState;
        await appendTaskState(tx, operation.serviceId, operation.taskId, taskState, operation.generation, `lifecycle:${operation.id}:settled:${operation.revision}`, now);
        await tx.update(tasks).set({ state: taskState, operationId: null }).where(and(eq(tasks.taskId, operation.taskId), eq(tasks.operationId, operation.id)));
      }
      return true;
    }),
  };
}
async function claimLifecycle(db: Database, owner: string, id?: string) {
  const candidates = await db.select({ id: ops.id, serviceId: ops.serviceId }).from(ops).where(and(ready(), id ? eq(ops.id, id) : undefined)).orderBy(asc(ops.updatedAt)).limit(100);
  for (const candidate of candidates) {
    const claim = await executionTransaction(db, candidate.serviceId, async (tx, now) => {
      const row = (await tx.select().from(ops).where(and(eq(ops.id, candidate.id), ready())).for('update', { skipLocked: true }))[0];
      if (!row) return undefined;
      if (!row.dispatched) {
        const control = await readExecutionControl(tx, row.serviceId);
        const draining = row.action !== 'resume' && control?.migration && control.phase === 'frozen' && control.epoch === row.epoch;
        if (!draining && (control || row.epoch !== null) && (!control || control.phase !== 'active' || !liveControl(control, now) || control.epoch !== row.epoch || (control.handoff && control.handoff.stage !== 'complete'))) return undefined;
      }
      const updated = (await tx.update(ops).set({ state: 'running', dispatched: true, owner, revision: row.revision + 1, leaseUntil: new Date(now.getTime() + 30_000), updatedAt: now }).where(eq(ops.id, row.id)).returning())[0]!;
      return lifecycleRow(updated);
    });
    if (claim) return claim;
  }
  return undefined;
}
