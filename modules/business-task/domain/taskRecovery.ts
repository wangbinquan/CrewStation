import type { BusinessRecoveryAction, BusinessRecoveryAssessment, BusinessRecoveryTarget, TaskId, SubtaskId } from '@crewstation/contracts';
import { jsonHash } from '@crewstation/kernel';
import type { ExecutionSubtask } from './executionSubtask';

export function recoveryChildStopped(child: Pick<ExecutionSubtask, 'view' | 'incarnation' | 'runtimeDispatched' | 'runtimeReleased' | 'receipt' | 'payloadDigest'> & { dispatch: string }, projection?: { sourceStopped: boolean; complete: boolean; sourceConsumed: boolean } | null): boolean {
  const neverStarted = child.view.process === 'not-started' && !child.incarnation && ((!child.runtimeDispatched && child.dispatch === 'failed') || (child.view.result?.reason === 'cancelled-before-start' && projection?.complete && projection.sourceConsumed));
  const receipt = child.receipt;
  // Natural completion has a consumed, contiguous final result; sourceStopped is reserved for forced cleanup.
  const finished = projection?.complete && projection.sourceConsumed && child.view.result && receipt?.phase === 'finished'
    && receipt.executionId === child.view.executionId && receipt.attempt === child.view.attempt && receipt.incarnation === child.incarnation && receipt.payloadDigest === child.payloadDigest
    && (child.view.kind === 'command' || child.runtimeReleased);
  return ['exited', 'not-started'].includes(child.view.process) && Boolean(projection?.sourceStopped || neverStarted || finished);
}

/** Facts only: callers obtain resource/compatibility proofs from their owning modules. Unknown never means stopped. */
export interface RecoveryFacts {
  taskId: TaskId; generation: number; materialDigest: string; state: string;
  capability: BusinessRecoveryAction[]; controllerOnline: boolean; controlEpoch: number;
  persistent: boolean; volumeUid: string | null; volumeVerified: boolean; imageCompatible: boolean;
  stopped: boolean; activeChildren: boolean; operationPending: boolean;
  child?: { id: SubtaskId; attempt: number; materialDigest: string; state: string; process: string; stopped: boolean; hasSuccessor: boolean; sessionId?: string; sessionCompatible: boolean };
}
export function recoveryAssessment(facts: RecoveryFacts): BusinessRecoveryAssessment {
  const reasons: string[] = [];
  if (!facts.capability.length) reasons.push('application_recovery_unsupported');
  if (!facts.controllerOnline) reasons.push('application_controller_offline');
  if (facts.operationPending) reasons.push('task_operation_pending');
  if (!facts.imageCompatible) reasons.push('original_image_incompatible');
  if (reasons.length) return { taskId: facts.taskId, actions: [], reasons };
  const target = { taskId: facts.taskId, expectedGeneration: facts.generation, materialDigest: facts.materialDigest };
  const actions: BusinessRecoveryTarget[] = [];
  if (facts.child) assessChild(facts, target, actions, reasons);
  else assessParent(facts, target, actions, reasons);
  const allowed = actions.filter((item) => facts.capability.includes(item.action));
  if (!allowed.length && !reasons.length) reasons.push('application_action_unsupported');
  return { taskId: facts.taskId, actions: allowed.map((item) => ({ target: item, assessmentDigest: jsonHash({ target: item, facts }) })), reasons };
}
function assessParent(f: RecoveryFacts, target: Pick<BusinessRecoveryTarget, 'taskId' | 'expectedGeneration' | 'materialDigest'>, actions: BusinessRecoveryTarget[], reasons: string[]) {
  if (!['paused', 'failed'].includes(f.state)) { reasons.push('task_not_recoverable'); return; }
  if (!f.stopped || f.activeChildren) { reasons.push('original_execution_not_stopped'); return; }
  if (f.persistent && f.volumeUid && f.volumeVerified) actions.push({ ...target, action: f.state === 'paused' ? 'resume-task' : 'rebuild-workspace', volumeUid: f.volumeUid });
  else { reasons.push('original_workspace_unavailable'); if (f.state === 'failed') actions.push({ ...target, action: 'restart-task' }); }
}
function assessChild(f: RecoveryFacts, target: Pick<BusinessRecoveryTarget, 'taskId' | 'expectedGeneration' | 'materialDigest'>, actions: BusinessRecoveryTarget[], reasons: string[]) {
  const child = f.child!;
  if (f.state !== 'running') { reasons.push('workspace_not_running'); return; }
  if (!['failed', 'cancelled'].includes(child.state) || child.hasSuccessor) { reasons.push('subtask_not_recoverable'); return; }
  if (!child.stopped || !['exited', 'not-started'].includes(child.process)) { reasons.push('original_execution_not_stopped'); return; }
  const childTarget = { ...target, materialDigest: jsonHash({ parent: f.materialDigest, child: child.materialDigest }), subtaskId: child.id, expectedAttempt: child.attempt };
  actions.push({ ...childTarget, action: 'retry-subtask' });
  if (child.sessionId && child.sessionCompatible) actions.push({ ...childTarget, action: 'resume-subtask', resumeSessionId: child.sessionId });
  else if (f.capability.includes('resume-subtask')) reasons.push('original_session_incompatible');
}
