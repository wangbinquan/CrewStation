import { describe, expect, test } from 'bun:test';
import type { ReleaseId, ServiceId, UserId } from '@crewstation/contracts';
import type { Release } from './release';
import { advance, isRedeployable } from './release';
import type { ServiceSlots } from './slots';
import { initialSlots, switchTraffic } from './slots';
import {
  DEFAULT_OFFLINE_POLICY, assertOfflinePolicy, markReminded, markWorkloadRemoved, normalizeLegacySlot, noteRetentionAccess,
  offlineDeadline, postponeRetention, retentionForExisting, retentionStep, startRetention, takeSlotOffline,
} from './slotLifecycle';

const H = 3_600_000, D = 24 * H;
const t0 = new Date('2026-09-23T00:00:00.000Z');
const at = (ms: number) => new Date(t0.getTime() + ms);
const service = Bun.randomUUIDv7() as ServiceId, v1 = Bun.randomUUIDv7() as ReleaseId, v2 = Bun.randomUUIDv7() as ReleaseId, owner = Bun.randomUUIDv7() as UserId;
const policy = DEFAULT_OFFLINE_POLICY;

function deployed(): ServiceSlots {
  const slots = initialSlots(service, t0);
  return { ...slots, blue: { ...slots.blue, releaseId: v1, state: 'ready', replicas: 1, readyReplicas: 1 }, green: { ...slots.green, releaseId: v2, state: 'ready', replicas: 1, readyReplicas: 1 } };
}

describe('到期时间', () => {
  test('回退目标从切流时起算 72 小时，访问不延长', () => {
    const r = noteRetentionAccess(startRetention('rollback-target', t0), at(70 * H));
    expect(offlineDeadline(r, policy)).toEqual(at(72 * H));
  });

  test('待验证版本以就绪与最近一次访问中较晚的为起点，14 天；更早的访问不把时间往回拨', () => {
    const r = startRetention('pending', t0);
    expect(offlineDeadline(r, policy)).toEqual(at(14 * D));
    const accessed = noteRetentionAccess(r, at(3 * D));
    expect(offlineDeadline(accessed, policy)).toEqual(at(17 * D));
    expect(noteRetentionAccess(accessed, at(2 * D))).toBe(accessed);
  });

  test('管理员改了时长，到期时间立即按新策略算', () => {
    const r = startRetention('rollback-target', t0);
    expect(offlineDeadline(r, { ...policy, rollbackRetentionHours: 24, reminderLeadHours: 6 })).toEqual(at(24 * H));
  });

  test('推迟＝当前到期时间再加一个周期，可以反复推迟，并清掉提醒', () => {
    const reminded = markReminded(startRetention('rollback-target', t0), at(72 * H), at(48 * H));
    const once = postponeRetention(reminded, policy);
    expect(offlineDeadline(once, policy)).toEqual(at(144 * H));
    expect(once.remindedAt).toBeUndefined();
    expect(once.postponements).toBe(1);
    const twice = postponeRetention(once, policy);
    expect(offlineDeadline(twice, policy)).toEqual(at(216 * H));
    expect(twice.postponements).toBe(2);
    // 待验证版本在访问把到期推后之后推迟，从推后的到期时间再加 14 天。
    const pending = noteRetentionAccess(startRetention('pending', t0), at(10 * D));
    expect(offlineDeadline(postponeRetention(pending, policy), policy)).toEqual(at(38 * D));
  });
});

describe('提醒与下线', () => {
  test('到期前 24 小时之前什么都不做，进入提醒窗口先提醒', () => {
    const r = startRetention('rollback-target', t0);
    expect(retentionStep(r, policy, at(47 * H)).action).toBe('none');
    expect(retentionStep(r, policy, at(48 * H))).toEqual({ action: 'remind', deadline: at(72 * H) });
  });

  test('提醒过当前到期时间后，到期才下线；到期前只是等待', () => {
    const r = markReminded(startRetention('rollback-target', t0), at(72 * H), at(48 * H));
    expect(retentionStep(r, policy, at(71 * H)).action).toBe('none');
    expect(retentionStep(r, policy, at(72 * H)).action).toBe('offline');
  });

  test('没有提醒绝不下线：调短时长后已过期的槽先提醒，提醒满 24 小时才下线', () => {
    const short = { ...policy, rollbackRetentionHours: 25, reminderLeadHours: 24 };
    const r = startRetention('rollback-target', t0);
    expect(retentionStep(r, short, at(100 * H)).action).toBe('remind');
    const reminded = markReminded(r, offlineDeadline(r, short), at(100 * H));
    expect(retentionStep(reminded, short, at(123 * H)).action).toBe('none');
    expect(retentionStep(reminded, short, at(124 * H)).action).toBe('offline');
  });

  test('提醒之后有人访问待验证版本，到期时间推后，旧提醒失效，新到期前重新提醒', () => {
    const r = markReminded(startRetention('pending', t0), at(14 * D), at(13 * D));
    const accessed = noteRetentionAccess(r, at(13 * D + H));
    expect(retentionStep(accessed, policy, at(14 * D)).action).toBe('none');
    expect(retentionStep(accessed, policy, at(26 * D + H)).action).toBe('remind');
  });
});

describe('下线与切流', () => {
  test('切流后原正式槽成为回退目标并开始计时，新正式槽不计时', () => {
    const slots = { ...deployed(), green: { ...deployed().green, retention: startRetention('pending', t0) } };
    const next = switchTraffic(slots, 'preview', v1, at(H), v2);
    expect(next.active).toBe('green');
    expect(next.blue.retention).toEqual({ kind: 'rollback-target', since: at(H), postponements: 0 });
    expect(next.green.retention).toBeUndefined();
  });

  test('首次上线时原正式槽是空的，不计时', () => {
    const slots = initialSlots(service, t0);
    const ready = { ...slots, green: { ...slots.green, releaseId: v2, state: 'ready' as const, replicas: 1, readyReplicas: 1 } };
    expect(switchTraffic(ready, 'preview', null, at(H), v2).blue.retention).toBeUndefined();
  });

  test('下线待命槽：槽变空、去掉版本与计时、写下线记录；正式槽与空槽拒绝', () => {
    const slots = { ...deployed(), green: { ...deployed().green, retention: startRetention('pending', t0) } };
    const next = takeSlotOffline(slots, 'green', at(H), { reason: 'manual', actorUserId: owner });
    expect(next.green).toEqual({ physical: 'green', state: 'empty', replicas: 0, readyReplicas: 0, updatedAt: at(H), offline: { releaseId: v2, at: at(H), reason: 'manual', actorUserId: owner, workloadRemoved: false } });
    expect(next.blue).toEqual(slots.blue);
    expect(markWorkloadRemoved(next.green).offline?.workloadRemoved).toBe(true);
    expect(() => takeSlotOffline(slots, 'blue', at(H), { reason: 'manual' })).toThrow('正式槽正在承接流量');
    expect(() => takeSlotOffline(next, 'green', at(2 * H), { reason: 'idle' })).toThrow('没有运行中的版本');
  });

  test('RFC-010 删除过的旧待命槽读取时归一成已下线（集群管理）；正式槽与正常槽不变', () => {
    const legacy = { physical: 'green' as const, releaseId: v2, state: 'empty' as const, replicas: 0, readyReplicas: 0, updatedAt: t0 };
    expect(normalizeLegacySlot(legacy, false)).toEqual({ physical: 'green', state: 'empty', replicas: 0, readyReplicas: 0, updatedAt: t0, offline: { releaseId: v2, at: t0, reason: 'cluster', workloadRemoved: true } });
    expect(normalizeLegacySlot(legacy, true)).toBe(legacy);
    const live = deployed().green;
    expect(normalizeLegacySlot(live, false)).toBe(live);
  });

  test('升级前就在跑的待命槽从本次巡检起算：最近一次切流从它切走的是回退目标，否则是待验证版本', () => {
    const slot = deployed().green;
    expect(retentionForExisting(slot, v2, at(H))).toEqual({ kind: 'rollback-target', since: at(H), postponements: 0 });
    expect(retentionForExisting(slot, v1, at(H)).kind).toBe('pending');
    expect(retentionForExisting(slot, undefined, at(H)).kind).toBe('pending');
  });
});

describe('策略与重新部署资格', () => {
  test('提醒时间必须短于两个周期，时长必须是正整数', () => {
    expect(() => assertOfflinePolicy(policy)).not.toThrow();
    expect(() => assertOfflinePolicy({ ...policy, reminderLeadHours: 72 })).toThrow('短于回退目标保留期');
    expect(() => assertOfflinePolicy({ ...policy, rollbackRetentionHours: 500, idleOfflineDays: 1 })).toThrow('短于无人访问期限');
    expect(() => assertOfflinePolicy({ ...policy, idleOfflineDays: 0 })).toThrow('正整数');
  });

  const release = (patch: Partial<Release>): Release => ({ id: v1, serviceId: service, projectId: Bun.randomUUIDv7() as Release['projectId'], tag: 'v0.1.0', commitSha: 'a'.repeat(40), branch: 'main', status: 'superseded', targetSlot: 'blue', image: 'registry/demo:v0.1.0', manifest: {} as Release['manifest'], pipeline: { step: 3 }, createdBy: owner, createdAt: t0, updatedAt: t0, ...patch });

  test('就绪过、有镜像与 Manifest、不在槽上的才能重新部署；失败的只有就绪过才行', () => {
    expect(isRedeployable(release({}), false)).toBe(true);
    expect(isRedeployable(release({ status: 'offline' }), false)).toBe(true);
    expect(isRedeployable(release({}), true)).toBe(false);
    expect(isRedeployable(release({ image: undefined }), false)).toBe(false);
    expect(isRedeployable(release({ status: 'failed' }), false)).toBe(false);
    expect(isRedeployable(release({ status: 'failed', pipeline: { step: 9, readyAt: t0.toISOString() } }), false)).toBe(true);
    expect(isRedeployable(release({ status: 'deploying' }), false)).toBe(false);
  });

  test('状态机：就绪可以下线，下线、被替换、就绪过的失败可以重新部署；下线后不能直接回到就绪', () => {
    expect(advance(release({ status: 'ready' }), 'offline', t0).status).toBe('offline');
    expect(advance(release({ status: 'offline' }), 'deploying', t0).status).toBe('deploying');
    expect(advance(release({ status: 'superseded' }), 'deploying', t0).status).toBe('deploying');
    expect(() => advance(release({ status: 'offline' }), 'ready', t0)).toThrow('不能从 offline 进入 ready');
  });
});
