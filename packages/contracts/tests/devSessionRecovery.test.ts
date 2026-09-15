import { expect, test } from 'bun:test';
import { DevSessionRebuildDtoSchema, RebuildDevSessionRequestSchema } from '../api/devSessionRecovery';
import { TaskIdSchema } from '../ids';

const request = { requestId: 'ef981d85-ce35-41fd-bbc8-2bace4d66068', expectedTaskId: TaskIdSchema.parse(`tsk_${'a'.repeat(32)}`), expectedUpdatedAt: '2026-09-15T10:00:00.000Z', expectedVolumeUid: 'original-volume', expectedPodUid: 'old-pod', profile: { name: 'coding-medium', cpu: '1', memory: '2Gi', storage: '10Gi' } };

test('保卷重建固定请求、任务、卷和套餐资源；已缺失 Pod 必须显式确认为 null', () => {
  expect(RebuildDevSessionRequestSchema.parse(request)).toEqual(request);
  expect(RebuildDevSessionRequestSchema.parse({ ...request, expectedPodUid: null }).expectedPodUid).toBeNull();
  for (const key of ['requestId', 'expectedTaskId', 'expectedUpdatedAt', 'expectedVolumeUid', 'expectedPodUid', 'profile']) {
    const invalid = { ...request }; Reflect.deleteProperty(invalid, key);
    expect(RebuildDevSessionRequestSchema.safeParse(invalid).success).toBe(false);
  }
  expect(RebuildDevSessionRequestSchema.safeParse({ ...request, expectedVolumeUid: '' }).success).toBe(false);
  expect(RebuildDevSessionRequestSchema.safeParse({ ...request, profile: { ...request.profile, model: 'tenant-choice' } }).success).toBe(false);
  expect(RebuildDevSessionRequestSchema.safeParse({ ...request, deleteVolume: true }).success).toBe(false);
});

test('恢复回执明确排队与等待 Runner，不将受理状态等同完成，也不包含凭据', () => {
  const receipt = { requestId: request.requestId, taskId: request.expectedTaskId, profile: request.profile, createdAt: request.expectedUpdatedAt, updatedAt: request.expectedUpdatedAt };
  for (const state of ['queued', 'replacing', 'starting', 'ready', 'failed'] as const) expect(DevSessionRebuildDtoSchema.parse({ ...receipt, state }).state).toBe(state);
  expect(DevSessionRebuildDtoSchema.safeParse({ ...receipt, state: 'accepted' }).success).toBe(false);
  expect(DevSessionRebuildDtoSchema.safeParse({ ...receipt, state: 'starting', runnerToken: 'never-return-credentials' }).success).toBe(false);
});
