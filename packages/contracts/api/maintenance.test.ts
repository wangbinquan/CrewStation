import { expect, test } from 'bun:test';
import { DeliveryStateSchema } from '../events/delivery';
import { DomainPayloadSchemas, DomainTopic, ReleaseStatusSchema } from '../events/topics';
import { ProjectIdSchema, ServiceIdSchema, UserIdSchema } from '../ids';
import { MarketAppDtoSchema } from './market/appListing';
import { ExitMaintenanceRequestSchema, MaintenanceDtoSchema, SetMaintenanceRequestSchema, ServiceMaintenanceViewSchema } from './maintenance';
import { ProjectStateSchema } from './project';

const user = () => UserIdSchema.parse(Bun.randomUUIDv7());
const switches = { users: true, services: false, events: true };

test('进入维护：原因去掉首尾空白后必填、最长 500；临时指定的人去重排序、最多 100；开关与请求都不收未知键', () => {
  const a = user(), b = user();
  const parsed = SetMaintenanceRequestSchema.parse({ switches, allowUserIds: [b, a, b], reason: '  修数据  ', expectedEndAt: '2026-09-23T10:00:00.000Z', expectedRevision: 0 });
  expect(parsed).toEqual({ switches, allowUserIds: [a, b].sort(), reason: '修数据', expectedEndAt: '2026-09-23T10:00:00.000Z', expectedRevision: 0 });
  expect(SetMaintenanceRequestSchema.parse({ switches, allowUserIds: [], reason: '修数据', expectedEndAt: null, expectedRevision: 3 }).expectedEndAt).toBeNull();
  for (const bad of [
    { switches, allowUserIds: [], reason: '   ', expectedRevision: 0 },
    { switches, allowUserIds: [], reason: 'x'.repeat(501), expectedRevision: 0 },
    { switches: { ...switches, dns: true }, allowUserIds: [], reason: '修数据', expectedRevision: 0 },
    { switches, allowUserIds: [], reason: '修数据', expectedRevision: 0, force: true },
    { switches, allowUserIds: Array.from({ length: 101 }, user), reason: '修数据', expectedRevision: 0 },
    { switches, allowUserIds: ['ops'], reason: '修数据', expectedRevision: 0 },
    { switches, allowUserIds: [], reason: '修数据', expectedEndAt: 'soon', expectedRevision: 0 },
  ]) expect(SetMaintenanceRequestSchema.safeParse(bad).success).toBe(false);
  expect(ExitMaintenanceRequestSchema.safeParse({ expectedRevision: 0 }).success).toBe(false);
  expect(ExitMaintenanceRequestSchema.parse({ expectedRevision: 2 })).toEqual({ expectedRevision: 2 });
});

test('维护视图：不在维护中时 current 为 null；在维护中带开关、原因、放行的人与版本号', () => {
  const serviceId = ServiceIdSchema.parse(Bun.randomUUIDv7()), projectId = ProjectIdSchema.parse(Bun.randomUUIDv7()), owner = user();
  expect(ServiceMaintenanceViewSchema.parse({ current: null, history: [] })).toEqual({ current: null, history: [] });
  const current = { serviceId, projectId, switches, allowUsers: [{ userId: owner, name: '王负责人', email: 'o@example.test' }], reason: '修数据', startedBy: owner, startedAt: '2026-09-23T01:00:00.000Z', updatedBy: owner, updatedAt: '2026-09-23T01:00:00.000Z', revision: 1 };
  expect(MaintenanceDtoSchema.parse(current) as unknown).toEqual(current);
  expect(MaintenanceDtoSchema.safeParse({ ...current, revision: 0 }).success).toBe(false);
  const event = { id: 'mev_1', serviceId, kind: 'exited', actorUserId: owner, at: '2026-09-23T02:00:00.000Z', switches, reason: '修数据', allowUserIds: [] };
  expect(ServiceMaintenanceViewSchema.parse({ current: null, history: [event] }).history[0]!.kind).toBe('exited');
});

test('新增状态值与主题：投递可以暂存、发布可以已下线；项目不再有暂停状态；维护变更主题带服务与事件开关', () => {
  expect(DeliveryStateSchema.parse('held')).toBe('held');
  expect(ReleaseStatusSchema.parse('offline')).toBe('offline');
  // RFC-021 §6 第 2 项：暂停项目整体作废，旧值不再被接受。
  expect(ProjectStateSchema.safeParse('paused').success).toBe(false);
  const payload = { occurredAt: '2026-09-23T01:00:00.000Z', projectId: Bun.randomUUIDv7(), serviceId: Bun.randomUUIDv7(), active: false, holdEvents: false };
  expect(DomainPayloadSchemas[DomainTopic.maintenanceChanged].parse(payload) as unknown).toEqual(payload);
});

test('市场卡片的维护标注可选：旧响应照常解析，新响应带原因与是否被拦', () => {
  const app = {
    projectId: Bun.randomUUIDv7(), name: '知识助手', description: '', icon: 'assistant', owner: { userId: Bun.randomUUIDv7(), name: '王' }, projectState: 'active',
    canDevelop: false, canConfigure: false, canPreview: false, visibilityRevision: 0, entry: { kind: 'production', status: 'ready', host: 'kb.cs.localhost' },
    production: { status: 'deployed', tag: 'v1.0.0', commitSha: 'a'.repeat(40), host: 'kb.cs.localhost', state: 'ready', freshness: 'current', checkedAt: '2026-09-23T01:00:00.000Z' }, checkedAt: '2026-09-23T01:00:00.000Z',
  };
  expect(MarketAppDtoSchema.parse(app).maintenance).toBeUndefined();
  expect(MarketAppDtoSchema.parse({ ...app, maintenance: { reason: '修数据', blocked: true } }).maintenance as unknown).toEqual({ reason: '修数据', blocked: true });
  expect(MarketAppDtoSchema.safeParse({ ...app, maintenance: { reason: '修数据' } }).success).toBe(false);
});
