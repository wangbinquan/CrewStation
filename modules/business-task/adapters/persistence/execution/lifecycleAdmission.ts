import { appendTaskState } from './logEvents';
import { and, eq, sql } from 'drizzle-orm';
import { conflict, newResourceId, notFound, precondition } from '@crewstation/kernel';
import type { Database, Executor } from '@crewstation/persistence';
import type { ExecutionLifecycles } from '../../../ports/executionLifecycle';
import type { ExecutionLifecycle } from '../../../domain/executionLifecycle';
import { authorizeExecution, authorizeStoppingExecution, executionTransaction } from '../executionTransaction';
import { executionOperations as parents } from '../executionTables';
import { executionSubtasks as children } from './subtaskTables';
import { executionLifecycles as ops, executionTaskStates as tasks } from './lifecycleTables';
import { authorizeRecoveryMutation, bindRecoveryMutation } from '../recovery/mutations';

export const lifecycleRow = (row: typeof ops.$inferSelect): ExecutionLifecycle => ({ ...row, taskId: row.taskId as ExecutionLifecycle['taskId'], action: row.action as ExecutionLifecycle['action'], priorState: row.priorState as ExecutionLifecycle['priorState'], state: row.state as ExecutionLifecycle['state'] });
export function requestLifecycle(db: Database): ExecutionLifecycles['request'] {
  return (serviceId, taskId, action, input, observed, authorization) => executionTransaction(db, serviceId, async (tx, now) => {
    if (input.recovery && action !== 'resume') throw precondition('恢复请求只能用于恢复动作');
    const recovery = await authorizeRecoveryMutation(tx, now, serviceId, { taskId, action: 'resume-task', requestKey: input.requestKey, expectedGeneration: input.expectedGeneration }, { ...authorization, recovery: input.recovery });
    const prior = (await tx.select().from(ops).where(and(eq(ops.serviceId, serviceId), eq(ops.taskId, taskId), eq(ops.action, action), eq(ops.requestKey, input.requestKey))))[0];
    if (prior && prior.expectedGeneration !== input.expectedGeneration) throw conflict('生命周期幂等键参数不同', { code: 'idempotency_conflict' });
    if (prior && prior.state !== 'retryable-rejected' && !(prior.state === 'pending' && !prior.dispatched && (input.fence || input.stopAuthority))) { await bindRecoveryMutation(tx, now, recovery, { operationId: prior.id }); return lifecycleRow(prior); }
    const parent = (await tx.select().from(parents).where(and(eq(parents.serviceId, serviceId), sql`${parents.intent}->'task'->>'id' = ${taskId}`)))[0];
    if (!parent) throw notFound('业务任务', taskId);
    if (action === 'resume' && authorization.stopAuthority) throw precondition('迁移停止权限不能恢复或新建执行');
    const epoch = await (action === 'resume' ? authorizeExecution : authorizeStoppingExecution)(tx, serviceId, parent.intent.tasksSpec.executionControl === 'fenced', authorization, now);
    if (prior?.state === 'pending' && !prior.dispatched) {
      const adopted = (await tx.update(ops).set({ epoch, updatedAt: now }).where(eq(ops.id, prior.id)).returning())[0]!;
      await bindRecoveryMutation(tx, now, recovery, { operationId: adopted.id });
      return lifecycleRow(adopted);
    }
    const current = (await tx.select().from(tasks).where(eq(tasks.taskId, taskId)))[0];
    const generation = current?.generation ?? parent.intent.task.generation, state = current?.state ?? observed;
    if (generation !== (prior?.generation ?? input.expectedGeneration) || current?.operationId) throw conflict('任务世代已变化或正在变更', { code: 'stale_generation' });
    if (parent.state !== 'succeeded') throw precondition('任务尚未完成准入', { code: 'task_not_running' });
    if (state === 'closed') throw conflict('任务已关闭', { code: 'task_closed' });
    if (action === 'pause' && !['running', 'paused'].includes(state)) throw conflict('当前任务不能暂停', { code: 'task_not_running' });
    if (action === 'resume' && state !== 'paused') throw conflict('当前任务不能恢复', { code: 'task_not_paused' });
    if (action !== 'resume') await assertNoActiveChildren(tx, serviceId, taskId);
    if (action === 'pause' && parent.intent.task.volumeMode !== 'persistent') throw precondition('暂停要求持久卷', { code: 'persistent_volume_required' });
    const id = prior?.id ?? newResourceId(), next = prior?.generation ?? generation + 1;
    const values = { serviceId, taskId, action, requestKey: input.requestKey, expectedGeneration: input.expectedGeneration, generation: next, priorState: state, epoch, state: 'pending', dispatched: false, errorCode: null, updatedAt: now };
    const row = (await tx.insert(ops).values({ id, ...values }).onConflictDoUpdate({ target: ops.id, set: values }).returning())[0]!;
    const task = { serviceId, generation: next, state: action === 'pause' ? 'pausing' : action === 'resume' ? 'creating' : 'closing', operationId: id };
    await tx.insert(tasks).values({ taskId, ...task }).onConflictDoUpdate({ target: tasks.taskId, set: task });
    await appendTaskState(tx, serviceId, taskId, task.state as ExecutionLifecycle['priorState'], next, `lifecycle:${id}:accepted:${now.toISOString()}`, now);
    await bindRecoveryMutation(tx, now, recovery, { operationId: id });
    return lifecycleRow(row);
  });
}
async function assertNoActiveChildren(tx: Executor, serviceId: string, taskId: string): Promise<void> {
  if ((await tx.select({ id: children.id }).from(children).where(and(eq(children.serviceId, serviceId), eq(children.taskId, taskId), sql`${children.view}->>'state' NOT IN ('succeeded','failed','cancelled')`)).limit(1)).length) throw conflict('请先取消活动子任务并等待结果确认', { code: 'active_subtasks' });
}

/** 与准入、生命周期受理共用服务锁；预检之后发生的 pause 也不能被穿透。 */
export async function assertTaskAcceptsExecution(tx: Executor, taskId: string): Promise<void> {
  const state = (await tx.select().from(tasks).where(eq(tasks.taskId, taskId)))[0];
  if (state && (state.operationId || state.state !== 'running')) throw conflict('任务当前不能受理执行', { code: state.state === 'paused' ? 'task_paused' : 'task_not_running' });
}
