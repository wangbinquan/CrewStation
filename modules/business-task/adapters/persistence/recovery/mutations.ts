import { eq } from 'drizzle-orm';
import type { Executor } from '@crewstation/persistence';
import { conflict, precondition } from '@crewstation/kernel';
import type { RecoveryMutation } from '../../../ports/taskRecovery';
import type { ExecutionAuthorization } from '../../../domain/executionControl';
import { assertRecoveryTarget, recoveryCapability } from './admission';
import { auditRecovery, ownedRecovery } from './ownership';
import { recoveryRequests } from './tables';

/** Called inside the same service transaction that reserves the actual operation/attempt. */
export async function authorizeRecoveryMutation(tx: Executor, now: Date, serviceId: string, mutation: RecoveryMutation, authorization: ExecutionAuthorization) {
  if (!authorization.recovery) return undefined;
  const row = await ownedRecovery(tx, now, serviceId, authorization.recovery.recoveryRequestId, { claimId: authorization.recovery.claimId, authorization }, true);
  const target = row.target;
  if (mutation.action !== target.action || mutation.taskId !== target.taskId || mutation.requestKey !== `recovery:${row.id}`) throw conflict('恢复动作或幂等键与原请求不一致', { code: 'recovery_target_mismatch' });
  if ('subtaskId' in target) {
    if (mutation.subtaskId !== target.subtaskId || mutation.expectedAttempt !== target.expectedAttempt || (target.action === 'resume-subtask' && mutation.resumeSessionId !== target.resumeSessionId)) throw conflict('恢复子任务、attempt 或原生会话不一致', { code: 'recovery_target_mismatch' });
  } else if (mutation.subtaskId || mutation.expectedGeneration !== target.expectedGeneration) throw conflict('恢复任务世代不一致', { code: 'recovery_target_mismatch' });
  await recoveryCapability(tx, serviceId, target.action, now);
  // After reservation the original generation/attempt has advanced. Replays verify the binding instead.
  if (!row.operationId && !row.resultSubtaskId && !row.resultTaskId) await assertRecoveryTarget(tx, serviceId, row.projectId, target);
  return row;
}
export async function bindRecoveryMutation(tx: Executor, now: Date, row: typeof recoveryRequests.$inferSelect | undefined, result: { operationId?: string; resultSubtaskId?: string; resultTaskId?: string }) {
  if (!row) return;
  if (row.state !== 'claimed') {
    if (row.operationId !== (result.operationId ?? null) || row.resultSubtaskId !== (result.resultSubtaskId ?? null) || row.resultTaskId !== (result.resultTaskId ?? null)) throw conflict('恢复请求已关联另一项实际操作', { code: 'recovery_operation_mismatch' });
    return;
  }
  if (!result.operationId && !result.resultSubtaskId && !result.resultTaskId) throw precondition('恢复请求必须关联实际操作');
  await tx.update(recoveryRequests).set({ ...result, state: 'running', updatedAt: now }).where(eq(recoveryRequests.id, row.id));
  await auditRecovery(tx, now, row.id, 'running', row.claimHolder!, row.claimEpoch);
}
