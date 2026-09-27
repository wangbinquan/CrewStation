import { expect, test } from 'bun:test';
import { BusinessRecoveryCapabilitySchema, BusinessRecoveryTargetSchema, RequestBusinessRecoverySchema } from './recovery';
import { TasksSpecSchema } from '../../manifest/tasks';

const id = '01a0e361-522b-7000-a97f-a6422abd20c7';
const target = BusinessRecoveryTargetSchema.parse({ taskId: id, expectedGeneration: 2, materialDigest: 'a'.repeat(64), action: 'resume-task', volumeUid: 'pvc-original' });
test('恢复意图必须指定原世代与摘要；动作严格区分父任务、新 attempt 和原生会话', () => {
  expect(RequestBusinessRecoverySchema.parse({ requestKey: 'click-once', target, assessmentDigest: 'b'.repeat(64) }).target).toEqual(target);
  for (const patch of [{ expectedGeneration: 0 }, { materialDigest: 'latest' }, { volumeUid: '' }, { runtimeImageVersionId: id }, { subtaskId: id }]) expect(BusinessRecoveryTargetSchema.safeParse({ ...target, ...patch }).success).toBe(false);
  const child = { taskId: id, expectedGeneration: 2, materialDigest: 'a'.repeat(64), subtaskId: id, expectedAttempt: 1 };
  expect(BusinessRecoveryTargetSchema.safeParse({ ...child, action: 'retry-subtask' }).success).toBe(true);
  expect(BusinessRecoveryTargetSchema.safeParse({ ...child, action: 'resume-subtask' }).success).toBe(false);
  expect(BusinessRecoveryTargetSchema.safeParse({ ...child, action: 'resume-subtask', resumeSessionId: 'native-session' }).success).toBe(true);
  expect(BusinessRecoveryTargetSchema.safeParse({ ...child, action: 'retry-subtask', resumeSessionId: 'native-session' }).success).toBe(false);
  expect(RequestBusinessRecoverySchema.safeParse({ requestKey: 'new\nkey', target, assessmentDigest: 'b'.repeat(64) }).success).toBe(false);
  expect(RequestBusinessRecoverySchema.safeParse({ requestKey: 'key', target, assessmentDigest: 'b'.repeat(64), requestedBy: id }).success).toBe(false);
});
test('恢复能力显式声明，不接受未知或重复动作', () => {
  expect(BusinessRecoveryCapabilitySchema.parse({ actions: ['resume-task', 'retry-subtask'] }).actions).toHaveLength(2);
  for (const input of [{ actions: [] }, { actions: ['retry-subtask', 'retry-subtask'] }, { actions: ['auto'] }, { actions: ['resume-task'], impersonate: true }]) expect(BusinessRecoveryCapabilitySchema.safeParse(input).success).toBe(false);
  const tasks = { taskProfileId: id, recovery: BusinessRecoveryCapabilitySchema.parse({ actions: ['resume-task'] }) };
  expect(TasksSpecSchema.safeParse(tasks).success).toBe(false);
  expect(TasksSpecSchema.parse({ ...tasks, executionControl: 'fenced', acceptedTaskContractVersions: ['v1'] }).recovery).toEqual(tasks.recovery);
  expect(TasksSpecSchema.parse({ taskProfileId: id })).not.toHaveProperty('recovery');
});
