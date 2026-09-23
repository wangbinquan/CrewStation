import { expect, test } from 'bun:test';
import type { MaintenanceDto } from '@crewstation/contracts';
import { autoOfflineDraft, validateAutoOffline } from '../features/admin/model/autoOfflineDraft';
import { blockingText, draftFromMaintenance, emptyMaintenanceDraft, fromLocalInput, fullMaintenanceWindow, maintenanceDraftChanged, maintenanceRequest, toLocalInput, validateMaintenanceDraft } from '../features/release/model/maintenanceDraft';
import { periodText } from '../features/release/model/useSlotLifecycle';

const now = new Date(2026, 8, 23, 10, 0);
const current = { serviceId: 's', projectId: 'p', switches: { users: true, services: false, events: true }, allowUsers: [{ userId: 'u1', name: '访客', email: 'g@test.invalid' }], reason: '换库',
  expectedEndAt: new Date(2026, 8, 23, 12, 30).toISOString(), startedBy: 'o', startedAt: now.toISOString(), updatedBy: 'o', updatedAt: now.toISOString(), revision: 3 } as unknown as MaintenanceDto;

// RFC-021 B1：进入维护三个开关默认全开；调整时带出全部字段，改动才算草稿。
test('维护草稿：默认值、从当前维护带出、变化判断与请求体', () => {
  expect(emptyMaintenanceDraft().switches).toEqual({ users: true, services: true, events: true });
  const draft = draftFromMaintenance(current);
  expect(draft).toMatchObject({ reason: '换库', expectedEnd: '2026-09-23T12:30' });
  expect(maintenanceDraftChanged(draft, draftFromMaintenance(current))).toBe(false);
  expect(maintenanceDraftChanged({ ...draft, allowUsers: [] }, draft)).toBe(true);
  expect(maintenanceDraftChanged({ ...draft, switches: { ...draft.switches, services: true } }, draft)).toBe(true);
  expect(maintenanceRequest({ ...draft, reason: '  换库  ' }, 3) as unknown).toEqual({ switches: { users: true, services: false, events: true }, allowUserIds: ['u1'], reason: '换库', expectedEndAt: current.expectedEndAt, expectedRevision: 3 });
  expect(maintenanceRequest({ ...draft, expectedEnd: '' }, 3).expectedEndAt).toBeNull();
});

test('维护草稿校验：原因必填且不超过 500 字，预计恢复时间可解析且晚于现在，放行不超过 100 人', () => {
  const draft = { ...emptyMaintenanceDraft(), reason: '换库' };
  expect(validateMaintenanceDraft(draft, now)).toEqual({});
  expect(validateMaintenanceDraft({ ...draft, reason: '   ' }, now).reason).toBe('release.maintenance.reasonRequired');
  expect(validateMaintenanceDraft({ ...draft, reason: '字'.repeat(501) }, now).reason).toBe('release.maintenance.reasonTooLong');
  expect(validateMaintenanceDraft({ ...draft, expectedEnd: '2026-09-23T10:00' }, now).expectedEnd).toBe('release.maintenance.endInPast');
  expect(validateMaintenanceDraft({ ...draft, expectedEnd: '明天' }, now).expectedEnd).toBe('release.maintenance.endInvalid');
  expect(validateMaintenanceDraft({ ...draft, expectedEnd: '2026-09-23T10:01' }, now)).toEqual({});
  const people = Array.from({ length: 101 }, (_, n) => ({ userId: `u${n}`, name: `人${n}`, email: `${n}@test.invalid` })) as never;
  expect(validateMaintenanceDraft({ ...draft, allowUsers: people }, now).allowUsers).toBe('release.maintenance.tooManyUsers');
});

test('本地时间与 ISO 互转；开关文案与破坏性迁移窗口；推迟周期的单位跟平台设置一致', () => {
  expect(fromLocalInput(toLocalInput(current.expectedEndAt!))?.toISOString()).toBe(current.expectedEndAt);
  expect(toLocalInput('不是时间')).toBe(''); expect(fromLocalInput('2026-13-40T99:99')).toBeUndefined();
  const t = (key: string) => ({ 'release.maintenance.switch.users': '用户访问', 'release.maintenance.switch.events': '事件推送', 'release.maintenance.separator': '、', 'release.maintenance.blockingNone': '不拦' })[key] ?? key;
  expect(blockingText(current.switches, t)).toBe('用户访问、事件推送');
  expect(blockingText({ users: false, services: false, events: false }, t)).toBe('不拦');
  expect(fullMaintenanceWindow(current.switches)).toBe(false); expect(fullMaintenanceWindow({ users: true, services: true, events: true })).toBe(true);
  expect(periodText({ kind: 'rollback-target', periodHours: 72 })).toEqual({ unit: 'hours', count: 72 });
  expect(periodText({ kind: 'pending', periodHours: 336 })).toEqual({ unit: 'days', count: 14 });
});

// RFC-021 M11、M12、M22：与服务端同一组范围；提前提醒必须短于两个周期。
test('自动下线设置：范围、提醒短于两个周期、请求带版本号', () => {
  const draft = autoOfflineDraft({ rollbackRetentionHours: 72, idleOfflineDays: 14, reminderLeadHours: 24, revision: 2, updatedAt: null });
  expect(validateAutoOffline(draft, 2)).toEqual({ errors: {}, request: { rollbackRetentionHours: 72, idleOfflineDays: 14, reminderLeadHours: 24, expectedRevision: 2 } });
  expect(validateAutoOffline({ ...draft, rollbackRetentionHours: '8761' }, 2).errors).toEqual({ rollbackRetentionHours: 'admin.settings.autoOffline.range.rollbackRetentionHours' });
  expect(validateAutoOffline({ ...draft, idleOfflineDays: '1.5' }, 2).errors.idleOfflineDays).toBe('admin.settings.autoOffline.range.idleOfflineDays');
  expect(validateAutoOffline({ ...draft, reminderLeadHours: '72' }, 2).errors).toEqual({ reminderLeadHours: 'admin.settings.autoOffline.leadVsRollback' });
  expect(validateAutoOffline({ ...draft, idleOfflineDays: '1', reminderLeadHours: '24' }, 2).errors).toEqual({ reminderLeadHours: 'admin.settings.autoOffline.leadVsIdle' });
  expect(validateAutoOffline({ ...draft, reminderLeadHours: '' }, 2).request).toBeUndefined();
});
