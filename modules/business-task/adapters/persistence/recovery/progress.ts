import { businessAdmissionOpen } from '../deletion/admission';
import { and, asc, eq, sql } from 'drizzle-orm';
import type { Database, Executor } from '@crewstation/persistence';
import { executionTransaction } from '../executionTransaction';
import { executionLifecycles } from '../execution/lifecycleTables';
import { executionSubtasks } from '../execution/subtaskTables';
import { executionOperations } from '../executionTables';
import { executionLogs } from '../execution/projectionTables';
import { recoveryRequests } from './tables';
import { auditRecovery } from './ownership';

export async function reconcileRecoveryRequests(db: Database): Promise<number> {
  const candidates = await db.select({ id: recoveryRequests.id, serviceId: recoveryRequests.serviceId }).from(recoveryRequests).where(and(businessAdmissionOpen(recoveryRequests.serviceId), eq(recoveryRequests.state, 'running'))).orderBy(sql`${recoveryRequests.observedAt} ASC NULLS FIRST`, asc(recoveryRequests.id)).limit(100);
  let progressed = 0;
  for (const candidate of candidates) progressed += await executionTransaction(db, candidate.serviceId, async (tx, now) => {
    const row = (await tx.select().from(recoveryRequests).where(and(eq(recoveryRequests.id, candidate.id), eq(recoveryRequests.state, 'running'))))[0];
    if (!row) return 0;
    await tx.update(recoveryRequests).set({ observedAt: now }).where(eq(recoveryRequests.id, row.id));
    const result = await observedResult(tx, row);
    if (!result) return 0;
    await tx.update(recoveryRequests).set({ ...result, leaseUntil: null, claimId: null, updatedAt: now }).where(eq(recoveryRequests.id, row.id));
    await auditRecovery(tx, now, row.id, result.state, 'platform-observation', null); return 1;
  });
  return progressed;
}
async function observedResult(tx: Executor, row: typeof recoveryRequests.$inferSelect): Promise<{ state: 'succeeded' | 'failed'; reason: string | null } | undefined> {
  if (row.target.action === 'restart-task') return observedRestart(tx, row);
  if (row.operationId) {
    const operation = (await tx.select().from(executionLifecycles).where(and(eq(executionLifecycles.id, row.operationId), eq(executionLifecycles.serviceId, row.serviceId), eq(executionLifecycles.taskId, row.taskId))))[0];
    if (operation?.requestKey !== `recovery:${row.id}`) return undefined;
    if (operation.state === 'succeeded') return { state: 'succeeded', reason: null };
    if (operation.state === 'failed') return { state: 'failed', reason: operation.errorCode ?? 'recovery_operation_failed' };
  }
  if (row.resultSubtaskId) {
    const child = (await tx.select().from(executionSubtasks).where(and(eq(executionSubtasks.id, row.resultSubtaskId), eq(executionSubtasks.serviceId, row.serviceId), eq(executionSubtasks.taskId, row.taskId))))[0];
    if (!child || child.requestKey !== `recovery:${row.id}` || !('subtaskId' in row.target) || child.requestParent !== row.target.subtaskId) return undefined;
    if (child.view.state === 'succeeded') return { state: 'succeeded', reason: null };
    if (['failed', 'cancelled'].includes(child.view.state) && ['exited', 'not-started'].includes(child.view.process)) return { state: 'failed', reason: child.view.error?.code ?? 'recovery_execution_failed' };
  }
  return undefined;
}

async function observedRestart(tx: Executor, row: typeof recoveryRequests.$inferSelect): Promise<{ state: 'succeeded' | 'failed'; reason: string | null } | undefined> {
  if (!row.operationId || !row.resultTaskId) return undefined;
  const operation = (await tx.select().from(executionOperations).where(and(eq(executionOperations.id, row.operationId), eq(executionOperations.serviceId, row.serviceId))))[0];
  if (!operation || operation.requestKey !== `recovery:${row.id}` || operation.parentId !== row.taskId || operation.intent.restartOf?.taskId !== row.taskId || operation.intent.task.id !== row.resultTaskId) return undefined;
  if (operation.state === 'failed') return { state: 'failed', reason: operation.errorCode ?? 'restart_admission_failed' };
  if (operation.state !== 'succeeded') return undefined;
  const observed = (await tx.select().from(executionLogs).where(and(eq(executionLogs.serviceId, row.serviceId), eq(executionLogs.taskId, row.resultTaskId))))[0];
  if (observed?.taskState === 'running') return { state: 'succeeded', reason: null };
  if (observed && ['failed', 'closed'].includes(observed.taskState ?? '')) return { state: 'failed', reason: 'restarted_task_failed' };
  return undefined;
}
