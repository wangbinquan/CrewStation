import { expect, test } from 'bun:test';
import { PublishDevSessionRequestSchema } from './devSession';
import { PublishRequestSchema, TrafficSwitchRequestSchema } from './release';
import { CreateReleaseTagRequestSchema } from './scm';
import { ReleaseIdSchema, TaskIdSchema } from '../ids';

test('发布来源契约保留完整 SHA 与会话身份；缩写、分支名和错误任务 ID 不能作为确认值', () => {
  const expectedCommitSha = 'a'.repeat(40), expectedTaskId = TaskIdSchema.parse(Bun.randomUUIDv7());
  expect(PublishDevSessionRequestSchema.parse({ branch: 'main', expectedCommitSha, expectedTaskId })).toEqual({ branch: 'main', version: 'patch', expectedCommitSha, expectedTaskId });
  for (const sha of ['a'.repeat(7), 'a'.repeat(41), 'HEAD', 'a;echo test', '']) {
    expect(PublishRequestSchema.safeParse({ branch: 'main', expectedCommitSha: sha }).success).toBe(false);
    expect(CreateReleaseTagRequestSchema.safeParse({ branch: 'main', bump: 'patch', expectedCommitSha: sha }).success).toBe(false);
  }
  expect(PublishDevSessionRequestSchema.safeParse({ branch: 'main', expectedTaskId: 'previous' }).success).toBe(false);
  expect(PublishRequestSchema.parse({ branch: 'main', expectedCommitSha: 'b'.repeat(64) }).expectedCommitSha).toHaveLength(64);
  expect(PublishDevSessionRequestSchema.parse({ branch: 'main' })).toEqual({ branch: 'main', version: 'patch' });
});

test('切流保留明确的空正式版本和指定目标，旧调用方省略字段仍有效', () => {
  const expectedTargetRelease = ReleaseIdSchema.parse(Bun.randomUUIDv7());
  expect(TrafficSwitchRequestSchema.parse({ toSlot: 'preview', expectedActiveRelease: null, expectedTargetRelease })).toEqual({ toSlot: 'preview', expectedActiveRelease: null, expectedTargetRelease });
  expect(TrafficSwitchRequestSchema.parse({ toSlot: 'preview' })).toEqual({ toSlot: 'preview' });
  expect(TrafficSwitchRequestSchema.safeParse({ toSlot: 'preview', expectedTargetRelease: 'latest' }).success).toBe(false);
});

test('下线、推迟、重新部署三个请求只收确认值：未知键、缩写 ID、非时间一律拒绝，待命槽为空用 null 明确表示', async () => {
  const { TakeOfflineRequestSchema, PostponeOfflineRequestSchema, RedeployRequestSchema } = await import('./release');
  const id = ReleaseIdSchema.parse(Bun.randomUUIDv7());
  expect(TakeOfflineRequestSchema.parse({ expectedReleaseId: id })).toEqual({ expectedReleaseId: id });
  expect(TakeOfflineRequestSchema.safeParse({ expectedReleaseId: id, force: true }).success).toBe(false);
  expect(TakeOfflineRequestSchema.safeParse({}).success).toBe(false);
  expect(PostponeOfflineRequestSchema.parse({ expectedDeadline: '2026-09-26T06:00:00.000Z' }).expectedDeadline).toBe('2026-09-26T06:00:00.000Z');
  expect(PostponeOfflineRequestSchema.safeParse({ expectedDeadline: 'tomorrow' }).success).toBe(false);
  expect(RedeployRequestSchema.parse({ expectedStandbyReleaseId: null })).toEqual({ expectedStandbyReleaseId: null });
  expect(RedeployRequestSchema.safeParse({}).success).toBe(false);
  expect(RedeployRequestSchema.safeParse({ expectedStandbyReleaseId: 'current' }).success).toBe(false);
});

test('槽的计时与下线字段可选：旧响应照常解析，新字段按形状校验；发布状态多了已下线', async () => {
  const { SlotDtoSchema, ReleaseDtoSchema } = await import('./release');
  const base = { name: 'preview', active: false, replicas: 0, readyReplicas: 0, state: 'empty', host: 'preview.demo.cs.localhost' };
  expect(SlotDtoSchema.parse(base) as unknown).toEqual(base);
  const releaseId = ReleaseIdSchema.parse(Bun.randomUUIDv7());
  const offline = { releaseId, tag: 'v0.1.2', at: '2026-09-23T01:00:00.000Z', reason: 'rollback-expired' };
  expect(SlotDtoSchema.parse({ ...base, offline }).offline as unknown).toEqual(offline);
  expect(SlotDtoSchema.safeParse({ ...base, offline: { ...offline, reason: 'expired' } }).success).toBe(false);
  const retention = { kind: 'pending', since: '2026-09-23T01:00:00.000Z', deadline: '2026-10-07T01:00:00.000Z', postponements: 0, periodHours: 336 };
  expect(SlotDtoSchema.parse({ ...base, state: 'ready', retention }).retention as unknown).toEqual(retention);
  expect(SlotDtoSchema.safeParse({ ...base, retention: { ...retention, postponements: -1 } }).success).toBe(false);
  expect(SlotDtoSchema.safeParse({ ...base, retention: { ...retention, periodHours: 0 } }).success).toBe(false);
  const release = { id: releaseId, serviceId: Bun.randomUUIDv7(), tag: 'v0.1.2', commitSha: 'a'.repeat(40), branch: 'main', status: 'offline', createdBy: Bun.randomUUIDv7(), createdAt: '2026-09-23T01:00:00.000Z', updatedAt: '2026-09-23T01:00:00.000Z', redeployable: true };
  expect(ReleaseDtoSchema.parse(release).status).toBe('offline');
});

test('自动下线时长：整数范围、提醒时间短于两个周期、带版本号；未知键拒绝', async () => {
  const { SetAutoOfflinePolicyRequestSchema, AutoOfflinePolicyDtoSchema } = await import('./release');
  const ok = { rollbackRetentionHours: 72, idleOfflineDays: 14, reminderLeadHours: 24, expectedRevision: 0 };
  expect(SetAutoOfflinePolicyRequestSchema.parse(ok)).toEqual(ok);
  const issues = (input: object) => { const r = SetAutoOfflinePolicyRequestSchema.safeParse(input); return r.success ? [] : r.error.issues.map((i) => i.message); };
  expect(issues({ ...ok, reminderLeadHours: 72 })).toContain('提前提醒的时间必须短于回退目标保留期');
  expect(issues({ ...ok, rollbackRetentionHours: 400, idleOfflineDays: 1 })).toContain('提前提醒的时间必须短于无人访问期限');
  for (const bad of [{ ...ok, rollbackRetentionHours: 0 }, { ...ok, idleOfflineDays: 366 }, { ...ok, reminderLeadHours: 1.5 }, { ...ok, extra: 1 }, { ...ok, expectedRevision: -1 }]) {
    expect(SetAutoOfflinePolicyRequestSchema.safeParse(bad).success).toBe(false);
  }
  expect(AutoOfflinePolicyDtoSchema.parse({ rollbackRetentionHours: 72, idleOfflineDays: 14, reminderLeadHours: 24, revision: 0, updatedAt: null }).revision).toBe(0);
});
