import type { RuntimeAttemptFact,RuntimeTaskHeaderFact,UsageExecutionIdentity,UsageRecord,UsageNativeCapture } from '@crewstation/contracts';
import { runtimeLedgerScope,runtimeOwnsIdentity } from './runtimeIdentity';

export const completeUsageIdentity=(record:Pick<UsageRecord,'identity'|'sourceId'|'recordId'>)=>JSON.stringify([completeObservedIdentity(record.identity),record.sourceId,record.recordId]);
export function completeAttemptIdentity(task:RuntimeTaskHeaderFact,attempt:RuntimeAttemptFact) {
  const scope=runtimeLedgerScope(task);
  return task.source?.kind==='development-agent'
    ? JSON.stringify(['development-agent',scope.projectId,scope.taskId,attempt.agentId,attempt.executionId,attempt.attempt])
    : JSON.stringify(['business-task',scope.projectId,scope.taskId,attempt.id,attempt.executionId,attempt.attempt]);
}
export function completeObservedIdentity(identity:UsageExecutionIdentity) {
  return 'sourceKind' in identity
    ? JSON.stringify([identity.sourceKind,identity.projectId,identity.taskId,identity.agentId,identity.executionId,identity.executionGeneration])
    : JSON.stringify(['business-task',identity.projectId,identity.taskId,identity.subtaskId,identity.executionId,identity.executionGeneration]);
}
export function assertCompleteTask(task:RuntimeTaskHeaderFact) {
  if(task.protocol==='development') {
    if(task.source?.kind!=='development-agent') throw new Error('Original development source identity missing');
    const i=task.source.identity;
    if(task.id!==i.executionId||task.projectId!==i.projectId||i.executionGeneration!==1||task.closedAt!==null) throw new Error('Original development parent identity changed');
  } else if(task.source?.kind==='development-agent') throw new Error('Original task source and protocol disagree');
}
export function assertCompleteAttempt(task:RuntimeTaskHeaderFact,attempt:RuntimeAttemptFact) {
  if (attempt.taskId!==runtimeLedgerScope(task).taskId) throw new Error('Original attempt belongs to another task');
  if (task.source?.kind!=='development-agent') return;
  const i=task.source.identity;
  if (task.protocol!=='development' || task.id!==i.executionId || task.projectId!==i.projectId || i.executionGeneration!==1 || attempt.id!==i.agentId || attempt.agentId!==i.agentId || attempt.executionId!==i.executionId || attempt.attempt!==1 || attempt.kind!=='agent' || !attempt.profileId || attempt.profileRevision===null || task.closedAt!==null || attempt.startedAt!==null || attempt.endedAt!==null) throw new Error('Original development admission identity changed');
}
export function assertCompleteObserved(task:RuntimeTaskHeaderFact,identity:UsageExecutionIdentity) {
  if (!runtimeOwnsIdentity(task,identity)) throw new Error('Original observation belongs to another task');
}
export const completeCaptureIdentity=(capture:UsageNativeCapture)=>JSON.stringify([completeObservedIdentity(capture.identity),capture.sourceId,capture.proof.root,capture.proof.turn,capture.proof.turnIndex]);
export const completeUsageCaptureIdentity=(record:UsageRecord)=>record.scope===null?null:JSON.stringify([completeObservedIdentity(record.identity),record.sourceId,record.scope.root,record.scope.turn,record.scope.turnIndex]);
