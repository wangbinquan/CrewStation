import { expect, test } from 'bun:test';
import type { ProjectId, ServiceId, UserId } from '@crewstation/contracts';
import type { Maintenance } from './maintenance';
import { admitsUser, applyMaintenance, assertExitRevision, blocksServiceCall, fullWindow, holdsEvents, retryAfterSeconds } from './maintenance';

const owner = { serviceId: Bun.randomUUIDv7() as ServiceId, projectId: Bun.randomUUIDv7() as ProjectId };
const alice = Bun.randomUUIDv7() as UserId, bob = Bun.randomUUIDv7() as UserId, guest = Bun.randomUUIDv7() as UserId;
const t0 = new Date('2026-09-23T00:00:00.000Z');
const all = { users: true, services: true, events: true };

function enter(switches = all, patch: Partial<{ allowUserIds: UserId[]; expectedEndAt: Date | null }> = {}): Maintenance {
  return applyMaintenance(undefined, owner, { switches, allowUserIds: patch.allowUserIds ?? [], reason: '修数据', expectedEndAt: patch.expectedEndAt ?? null, expectedRevision: 0 }, alice, t0);
}

test('进入维护从版本 1 开始；调整保留最初的进入人与时间、版本加一；版本号对不上一律拒绝', () => {
  const entered = enter();
  expect(entered).toMatchObject({ revision: 1, startedBy: alice, startedAt: t0, updatedBy: alice, reason: '修数据' });
  expect(entered.expectedEndAt).toBeUndefined();
  const later = new Date(t0.getTime() + 60_000);
  const adjusted = applyMaintenance(entered, owner, { switches: { ...all, events: false }, allowUserIds: [guest], reason: '修数据二', expectedEndAt: later, expectedRevision: 1 }, bob, later);
  expect(adjusted).toMatchObject({ revision: 2, startedBy: alice, startedAt: t0, updatedBy: bob, updatedAt: later, allowUserIds: [guest], expectedEndAt: later });
  expect(() => applyMaintenance(adjusted, owner, { switches: all, allowUserIds: [], reason: 'x', expectedRevision: 1 }, bob, later)).toThrow('已被他人修改');
  expect(() => applyMaintenance(undefined, owner, { switches: all, allowUserIds: [], reason: 'x', expectedRevision: 2 }, bob, later)).toThrow('已被他人修改');
  expect(assertExitRevision(adjusted, 2)).toBe(adjusted);
  expect(() => assertExitRevision(adjusted, 1)).toThrow('已被他人修改');
  expect(() => assertExitRevision(undefined, 1)).toThrow('已不在维护中');
});

test('用户流量：开关关着所有人都进；开着时只放行成员与管理员、临时指定的人', () => {
  expect(admitsUser(undefined, guest, false)).toBe(true);
  expect(admitsUser(enter({ ...all, users: false }), guest, false)).toBe(true);
  expect(admitsUser(enter(), guest, false)).toBe(false);
  expect(admitsUser(enter(), bob, true)).toBe(true);
  expect(admitsUser(enter(all, { allowUserIds: [guest] }), guest, false)).toBe(true);
});

test('服务域：开关开着才拦，而且只拦服务身份不同的调用方（项目自己的负载不拦）', () => {
  expect(blocksServiceCall(undefined, 'a/a', 'b/b')).toBe(false);
  expect(blocksServiceCall(enter({ ...all, services: false }), 'a/a', 'b/b')).toBe(false);
  expect(blocksServiceCall(enter(), 'a/a', 'b/b')).toBe(true);
  expect(blocksServiceCall(enter(), 'b/b', 'b/b')).toBe(false);
});

test('事件暂存看事件开关；破坏性迁移窗口要求三个开关都拦', () => {
  expect(holdsEvents(undefined)).toBe(false);
  expect(holdsEvents(enter({ ...all, events: false }))).toBe(false);
  expect(holdsEvents(enter())).toBe(true);
  expect(fullWindow(undefined)).toBe(false);
  expect(fullWindow(enter())).toBe(true);
  for (const key of ['users', 'services', 'events'] as const) expect(fullWindow(enter({ ...all, [key]: false }))).toBe(false);
});

test('Retry-After：预计恢复时间在未来才给，最少 60 秒；没有或已过去则不给', () => {
  expect(retryAfterSeconds(enter(), t0)).toBeUndefined();
  expect(retryAfterSeconds(enter(all, { expectedEndAt: new Date(t0.getTime() + 10_000) }), t0)).toBe(60);
  expect(retryAfterSeconds(enter(all, { expectedEndAt: new Date(t0.getTime() + 3_600_000) }), t0)).toBe(3600);
  expect(retryAfterSeconds(enter(all, { expectedEndAt: new Date(t0.getTime() - 1) }), t0)).toBeUndefined();
});
