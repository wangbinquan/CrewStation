import { and, eq, sql } from 'drizzle-orm';
import type { Executor } from '@crewstation/persistence';
import type { BusinessRecoveryAction, BusinessRecoveryTarget } from '@crewstation/contracts';
import { jsonHash, notFound, precondition } from '@crewstation/kernel';
import { executionOperations } from '../executionTables';
import { executionTaskStates } from '../execution/lifecycleTables';
import { executionLogs, subtaskProjections } from '../execution/projectionTables';
import { executionSubtasks } from '../execution/subtaskTables';
import { readExecutionControl } from '../executionTransaction';
import { activeExecutionControl } from '../../../domain/executionControl';
import { recoveryChildStopped } from '../../../domain/taskRecovery';
import { contracts } from '../tables';

export async function recoveryCapability(tx: Executor, serviceId: string, action: BusinessRecoveryTarget['action'], now: Date, epoch?: number): Promise<void> {
  if (!(await recoveryCapabilities(tx, serviceId, now, epoch)).includes(action)) throw precondition('当前应用版本未声明该恢复动作', { code: 'application_recovery_unsupported' });
}
export async function recoveryCapabilities(tx: Executor, serviceId: string, now: Date, epoch?: number): Promise<BusinessRecoveryAction[]> {
  const control = await readExecutionControl(tx, serviceId);
  if (!control || !activeExecutionControl(control, now)) throw precondition('所属应用没有在线执行控制器', { code: 'application_controller_offline' });
  if (epoch !== undefined && control.epoch !== epoch) throw precondition('恢复评估后执行权已变化', { code: 'recovery_assessment_stale' });
  const contract = (await tx.select({ spec: contracts.tasksSpec }).from(contracts).where(and(eq(contracts.serviceId, serviceId), eq(contracts.releaseId, control.activeReleaseId!))))[0];
  return contract?.spec?.recovery?.actions ?? [];
}
/** Re-read the immutable material and mutable generation under the same lock as lifecycle/retry admission. */
export async function assertRecoveryTarget(tx: Executor, serviceId: string, projectId: string, target: BusinessRecoveryTarget): Promise<void> {
  const parent = (await tx.select().from(executionOperations).where(and(eq(executionOperations.serviceId, serviceId), sql`${executionOperations.intent}->'task'->>'id' = ${target.taskId}`)))[0];
  if (!parent || parent.intent.projectId !== projectId) throw notFound('业务任务', target.taskId);
  const lifecycle = (await tx.select().from(executionTaskStates).where(and(eq(executionTaskStates.serviceId, serviceId), eq(executionTaskStates.taskId, target.taskId))))[0];
  const observation = (await tx.select().from(executionLogs).where(and(eq(executionLogs.serviceId, serviceId), eq(executionLogs.taskId, target.taskId))))[0];
  const generation = lifecycle?.generation ?? parent.intent.task.generation;
  const state = lifecycle?.operationId ? lifecycle.state : observation?.taskState ?? lifecycle?.state ?? parent.intent.task.state;
  if (generation !== target.expectedGeneration || lifecycle?.operationId) stale();
  if ('subtaskId' in target) {
    if (state !== 'running') stale();
    await assertRecoveryChild(tx, serviceId, target, parent.effectiveDigest);
  } else {
    if (target.materialDigest !== parent.effectiveDigest || state !== (target.action === 'resume-task' ? 'paused' : 'failed')) stale();
    if ('volumeUid' in target && parent.intent.task.volumeMode !== 'persistent') stale();
    const active = await tx.select({ id: executionSubtasks.id }).from(executionSubtasks).where(and(eq(executionSubtasks.serviceId, serviceId), eq(executionSubtasks.taskId, target.taskId), sql`(${executionSubtasks.view}->>'state' NOT IN ('succeeded','failed','cancelled') OR ${executionSubtasks.view}->>'process' NOT IN ('exited','not-started'))`)).limit(1);
    if (active.length) throw precondition('旧执行尚未确认停止', { code: 'original_execution_not_stopped' });
  }
}
async function assertRecoveryChild(tx: Executor, serviceId: string, target: Extract<BusinessRecoveryTarget, { subtaskId: string }>, parentDigest: string): Promise<void> {
  const child = (await tx.select().from(executionSubtasks).where(and(eq(executionSubtasks.serviceId, serviceId), eq(executionSubtasks.taskId, target.taskId), eq(executionSubtasks.id, target.subtaskId))))[0];
  if (!child || child.view.attempt !== target.expectedAttempt || !['failed', 'cancelled'].includes(child.view.state) || target.materialDigest !== jsonHash({ parent: parentDigest, child: child.payloadDigest })) stale();
  const projection = (await tx.select().from(subtaskProjections).where(eq(subtaskProjections.subtaskId, child.id)))[0];
  if (!recoveryChildStopped(child, projection)) throw precondition('旧执行尚未确认停止', { code: 'original_execution_not_stopped' });
  if (target.action === 'resume-subtask' && (child.view.kind !== 'agent' || child.view.sessionId !== target.resumeSessionId)) stale();
  if ((await tx.select({ id: executionSubtasks.id }).from(executionSubtasks).where(and(eq(executionSubtasks.serviceId, serviceId), eq(executionSubtasks.taskId, target.taskId), eq(executionSubtasks.requestKind, 'retry'), eq(executionSubtasks.requestParent, target.subtaskId))).limit(1)).length) stale();
}
function stale(): never { throw precondition('任务、执行或原材料已变化，请重新评估恢复条件', { code: 'recovery_assessment_stale' }); }
