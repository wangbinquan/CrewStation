import type { Executor } from '@crewstation/persistence';
import { precondition } from '@crewstation/kernel';
import type { ExecutionAuthorization } from '../../../domain/executionControl';
import type { OperationCandidate } from '../../../domain/taskAdmission';
import { authorizeRecoveryMutation } from './mutations';

export async function authorizeRestart(tx: Executor, now: Date, operation: OperationCandidate, authorization?: ExecutionAuthorization) {
  const target = operation.intent.restartOf;
  if (!target) return undefined;
  if (!authorization?.recovery || operation.parentId !== target.taskId) throw precondition('重新执行必须关联已认领恢复请求');
  return authorizeRecoveryMutation(tx, now, operation.serviceId, { action: 'restart-task', taskId: target.taskId,
    expectedGeneration: target.expectedGeneration, requestKey: operation.requestKey }, authorization);
}
