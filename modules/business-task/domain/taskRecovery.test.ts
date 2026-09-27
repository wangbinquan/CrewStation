import { expect, test } from 'bun:test';
import { BusinessSubtaskV3DtoSchema, type RunnerBusinessReceipt, type TaskId, type SubtaskId } from '@crewstation/contracts';
import { recoveryAssessment, recoveryChildStopped, type RecoveryFacts } from './taskRecovery';

const base: RecoveryFacts = {
  taskId: 'task' as TaskId, generation: 3, materialDigest: 'a'.repeat(64), state: 'paused', capability: ['resume-task', 'rebuild-workspace', 'retry-subtask', 'resume-subtask', 'restart-task'],
  controllerOnline: true, controlEpoch: 2, persistent: true, volumeUid: 'original-volume', volumeVerified: true, imageCompatible: true, stopped: true, activeChildren: false, operationPending: false,
};
test('原卷恢复与从头新建严格分开，变化的世代、原材料、执行权使评估失效', () => {
  const assessment = recoveryAssessment(base);
  expect(assessment.actions[0]?.target).toEqual({ taskId: 'task' as TaskId, expectedGeneration: 3, materialDigest: base.materialDigest, action: 'resume-task', volumeUid: 'original-volume' });
  expect(recoveryAssessment({ ...base, state: 'failed' }).actions[0]?.target.action).toBe('rebuild-workspace');
  for (const delta of [{ generation: 4 }, { materialDigest: 'b'.repeat(64) }, { controlEpoch: 3 }, { volumeUid: 'replacement' }]) expect(recoveryAssessment({ ...base, ...delta }).actions[0]?.assessmentDigest).not.toBe(assessment.actions[0]?.assessmentDigest);
  expect(recoveryAssessment({ ...base, volumeVerified: false }).actions).toHaveLength(0);
  expect(recoveryAssessment({ ...base, state: 'failed', volumeVerified: false })).toMatchObject({ actions: [{ target: { action: 'restart-task' } }], reasons: ['original_workspace_unavailable'] });
  expect(recoveryAssessment({ ...base, state: 'failed', volumeUid: null, capability: ['rebuild-workspace'] }).actions).toHaveLength(0);
});
test('不可用原因来自真实事实；未知状态与未停止执行不自动重跑', () => {
  for (const [delta, reason] of [
    [{ capability: [] }, 'application_recovery_unsupported'], [{ controllerOnline: false }, 'application_controller_offline'], [{ operationPending: true }, 'task_operation_pending'],
    [{ imageCompatible: false }, 'original_image_incompatible'], [{ stopped: false }, 'original_execution_not_stopped'], [{ activeChildren: true }, 'original_execution_not_stopped'],
    [{ state: 'unknown' }, 'task_not_recoverable'], [{ capability: ['retry-subtask'] }, 'application_action_unsupported'],
  ] as Array<[Partial<RecoveryFacts>, string]>) {
    const result = recoveryAssessment({ ...base, ...delta }); expect(result.actions).toHaveLength(0); expect(result.reasons).toContain(reason);
  }
});
test('子任务 fresh 与 resume 均固定旧 attempt 和材料，unknown 与已有后继不允许重试', () => {
  const child = { id: 'child' as SubtaskId, attempt: 2, materialDigest: 'b'.repeat(64), state: 'failed', process: 'exited', stopped: true, hasSuccessor: false, sessionId: 'native-session', sessionCompatible: true };
  const facts = { ...base, state: 'running', child };
  const result = recoveryAssessment(facts); expect(result.actions.map((a) => a.target.action)).toEqual(['retry-subtask', 'resume-subtask']);
  expect(result.actions[1]?.target).toMatchObject({ subtaskId: 'child', expectedAttempt: 2, resumeSessionId: 'native-session' });
  expect(recoveryAssessment({ ...facts, child: { ...child, sessionCompatible: false } })).toMatchObject({ actions: [{ target: { action: 'retry-subtask' } }], reasons: ['original_session_incompatible'] });
  for (const delta of [{ stopped: false }, { process: 'unknown' }, { hasSuccessor: true }, { state: 'succeeded' }]) expect(recoveryAssessment({ ...facts, child: { ...child, ...delta } }).actions).toHaveLength(0);
  expect(recoveryAssessment({ ...facts, state: 'paused' }).reasons).toEqual(['workspace_not_running']);
});
test('完整消费的退出回执绑定原执行；未知状态、错误材料和未释放Agent仍拒绝', () => {
  const executionId = '01900000-0000-7000-8000-000000000003', incarnation = '01900000-0000-7000-8000-000000000004', payloadDigest = 'a'.repeat(64);
  const view = BusinessSubtaskV3DtoSchema.parse({ id: '01900000-0000-7000-8000-000000000001', taskId: '01900000-0000-7000-8000-000000000002', name: 'failure', kind: 'command', state: 'failed', process: 'exited', attempt: 1, executionId, createdAt: new Date().toISOString(), result: { exitCode: 1, reason: 'exited', stdout: '', stderr: '', truncated: false, files: [], finalCursor: 'terminal-cursor' } });
  const receipt: RunnerBusinessReceipt = { executionId, incarnation, payloadDigest, attempt: 1, phase: 'finished', lastSequence: 2, acknowledgedSequence: 2, outputBytes: 0, result: { exitCode: 1, reason: 'exited', durationMs: 100 } };
  const child = { view, receipt, incarnation, payloadDigest, dispatch: 'accepted' as const }, proof = { sourceStopped: false, complete: true, sourceConsumed: true };
  expect(recoveryChildStopped(child, proof)).toBe(true);
  for (const delta of [{ complete: false }, { sourceConsumed: false }]) expect(recoveryChildStopped(child, { ...proof, ...delta })).toBe(false);
  expect(recoveryChildStopped(child)).toBe(false);
  expect(recoveryChildStopped({ ...child, receipt: null }, proof)).toBe(false);
  for (const delta of [{ phase: 'unknown' as const }, { executionId: incarnation }, { attempt: 2 }, { incarnation: executionId }, { payloadDigest: 'b'.repeat(64) }]) expect(recoveryChildStopped({ ...child, receipt: { ...receipt, ...delta } }, proof)).toBe(false);
  expect(recoveryChildStopped({ ...child, view: { ...view, process: 'unknown' } }, proof)).toBe(false);
  expect(recoveryChildStopped({ ...child, view: { ...view, kind: 'agent' } }, proof)).toBe(false);
  expect(recoveryChildStopped({ ...child, view: { ...view, kind: 'agent' }, runtimeReleased: true }, proof)).toBe(true);
});
