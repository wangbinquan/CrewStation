import { describe, expect, test } from 'bun:test';
import type { ProjectId, ReleaseId, ServiceId } from '@crewstation/contracts';
import { projectSlots, slotCountsFromLedger, slotStateFromLedger } from './ledgerProjection';
import { DEFAULT_OFFLINE_POLICY, markReminded, offlineDeadline, startRetention } from './slotLifecycle';
import { initialSlots, withSlot } from './slots';

const now = new Date('2026-09-23T12:00:00.000Z');
const serviceId = '01a0bf5d-8f4b-7aea-8983-7b41e8b30564' as ServiceId, projectId = '01a0bf5d-8f4b-7710-89f8-83b88c835ea7' as ProjectId;
const service = { projectId, name: 'demo', namespace: 'cs-demo' };
const r1 = '01a0bf5d-8f4b-7aea-8983-7b41e8b30001' as ReleaseId, r2 = '01a0bf5d-8f4b-7aea-8983-7b41e8b30002' as ReleaseId;
const tags = new Map<string, string>([[r1, 'v0.1.0'], [r2, 'v0.1.1']]);

describe('服务槽投影到资源台账（RFC-025 第三期）', () => {
  test('每个服务两条记录（线上在前），子对象是 <服务>-<物理槽> 的 Deployment 与同名 Service；展示字段是物理槽、角色、版本', () => {
    const slots = withSlot(withSlot(initialSlots(serviceId, now), { physical: 'blue', releaseId: r1, state: 'ready', replicas: 1, readyReplicas: 1, updatedAt: now }, now), { physical: 'green', releaseId: r2, state: 'deploying', replicas: 1, readyReplicas: 0, updatedAt: now }, now);
    const [prod, preview] = projectSlots(slots, service, (id) => tags.get(id));
    expect(prod).toEqual({
      ref: `${serviceId}/blue`, projectId, children: [{ kind: 'Deployment', namespace: 'cs-demo', name: 'demo-blue' }, { kind: 'Service', namespace: 'cs-demo', name: 'demo-blue' }],
      display: { physical: 'blue', role: 'prod', releaseId: r1, tag: 'v0.1.0' }, conditions: [{ type: 'Serving', status: 'true' }, { type: 'Failed', status: 'false' }, { type: 'RetentionDeadline', status: 'false' }],
    });
    expect(preview?.display).toEqual({ physical: 'green', role: 'preview', releaseId: r2, tag: 'v0.1.1' });
    expect(projectSlots({ ...slots, active: 'green' }, service, (id) => tags.get(id)).map((slot) => slot.display.role)).toEqual(['prod', 'preview']);
  });

  test('尚未部署与下线是 Serving 为假（原因照写，下线带时刻）；部署失败是 Failed', () => {
    const empty = projectSlots(initialSlots(serviceId, now), service, () => undefined);
    expect(empty[1]?.conditions[0]).toEqual({ type: 'Serving', status: 'false', reason: 'not-deployed', message: '尚未部署' });
    const at = new Date('2026-09-23T11:00:00.000Z');
    const offline = withSlot(initialSlots(serviceId, now), { physical: 'green', state: 'empty', replicas: 0, readyReplicas: 0, updatedAt: at, offline: { releaseId: r2, at, reason: 'idle', workloadRemoved: true } }, now);
    const standby = projectSlots(offline, service, (id) => tags.get(id))[1]!;
    expect(standby.conditions[0]).toEqual({ type: 'Serving', status: 'false', reason: 'offline-idle', message: '待验证版本长时间无人访问，已自动下线', since: at });
    expect(standby.display).toMatchObject({ releaseId: r2, tag: 'v0.1.1' });
    const failed = withSlot(initialSlots(serviceId, now), { physical: 'green', releaseId: r2, state: 'failed', replicas: 1, readyReplicas: 0, updatedAt: at }, now);
    expect(projectSlots(failed, service, () => undefined)[1]?.conditions[1]).toEqual({ type: 'Failed', status: 'true', reason: 'deploy-failed', message: '部署未能就绪', since: at });
  });

  test('待命槽的保留计时（RetentionDeadline）：回退目标与待验证版本各有原因；到期时刻、周期、推迟次数进展示字段，提醒过、可推迟时带提醒时刻；线上槽没有', () => {
    const retention = startRetention('rollback-target', now);
    const slots = withSlot(withSlot(initialSlots(serviceId, now), { physical: 'blue', releaseId: r1, state: 'ready', replicas: 1, readyReplicas: 1, updatedAt: now }, now),
      { physical: 'green', releaseId: r2, state: 'ready', replicas: 1, readyReplicas: 1, updatedAt: now, retention }, now);
    const deadline = offlineDeadline(retention, DEFAULT_OFFLINE_POLICY);
    const [prod, standby] = projectSlots(slots, service, (id) => tags.get(id));
    expect(prod?.conditions[2]).toEqual({ type: 'RetentionDeadline', status: 'false' });
    expect(standby?.conditions[2]).toEqual({ type: 'RetentionDeadline', status: 'true', reason: 'rollback-target', message: '回退目标：保留期满后自动下线' });
    expect(standby?.display).toEqual({ physical: 'green', role: 'preview', releaseId: r2, tag: 'v0.1.1', retentionDeadline: '2026-09-26T12:00:00.000Z', retentionPeriodHours: '72', retentionPostponements: '0' });
    const reminded = withSlot(slots, { ...slots.green, retention: markReminded(retention, deadline, new Date('2026-09-25T13:00:00.000Z')) }, now);
    expect(projectSlots(reminded, service, () => undefined)[1]?.display['retentionRemindedAt']).toBe('2026-09-25T13:00:00.000Z');
    // 策略改短：到期时刻按当前策略即时重算。
    expect(projectSlots(slots, service, () => undefined, { ...DEFAULT_OFFLINE_POLICY, rollbackRetentionHours: 48 })[1]?.display).toMatchObject({ retentionDeadline: '2026-09-25T12:00:00.000Z', retentionPeriodHours: '48' });
    const pending = withSlot(slots, { ...slots.green, retention: startRetention('pending', now) }, now);
    expect(projectSlots(pending, service, () => undefined)[1]?.conditions[2]).toMatchObject({ reason: 'pending', message: '待验证版本：长时间无人访问后自动下线' });
  });

  test('就绪之后的副本数照 Deployment 的观测；流水线推进中、没有观测到副本数、Deployment 不在时以流水线为准', () => {
    const observed = { children: [{ kind: 'Deployment', phase: 'Unready', replicas: 2, readyReplicas: 1 }] };
    expect(slotCountsFromLedger('ready', observed)).toEqual({ replicas: 2, readyReplicas: 1 });
    expect(slotCountsFromLedger('deploying', observed)).toBeUndefined();
    expect(slotCountsFromLedger('ready', { children: [{ kind: 'Deployment', phase: 'Available' }] })).toBeUndefined();
    expect(slotCountsFromLedger('ready', { children: [{ kind: 'Deployment', phase: 'absent', replicas: 1, readyReplicas: 0 }] })).toBeUndefined();
    expect(slotCountsFromLedger('ready', undefined)).toBeUndefined();
  });

  test('旧接口状态：流水线推进中、空槽、已判失败以流水线为准；就绪之后照台账：降级、失败、重新铺开是部署中', () => {
    expect(slotStateFromLedger('deploying', 'ready')).toBe('deploying');
    expect(slotStateFromLedger('empty', 'stopped')).toBe('empty');
    expect(slotStateFromLedger('failed', 'ready')).toBe('failed');
    expect(slotStateFromLedger('ready', undefined)).toBe('ready');
    expect(slotStateFromLedger('ready', 'ready')).toBe('ready');
    expect(slotStateFromLedger('ready', 'degraded')).toBe('degraded');
    expect(slotStateFromLedger('ready', 'failed')).toBe('failed');
    expect(slotStateFromLedger('ready', 'starting')).toBe('deploying');
    expect(slotStateFromLedger('ready', 'stopping')).toBe('ready');
  });
});
