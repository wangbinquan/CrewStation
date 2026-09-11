import { describe, expect, test } from 'bun:test';
import type { EventId, ProjectId, ServiceId, TraceId } from '@crewstation/contracts';
import { backoffSeconds } from './backoff';
import { beginAttempt, markDelivered, markFailed, newDelivery, replayDelivery } from './delivery';
import { reconcileSubscriptions } from './subscription';

const now = new Date('2026-09-11T00:00:00Z');
const owner = { serviceId: 'svc_0123456789abcdef0123456789abcdef' as ServiceId, projectId: 'prj_0123456789abcdef0123456789abcdef' as ProjectId };
const event = { id: 'evt_0123456789abcdef0123456789abcdef' as EventId, eventType: 'gitlab.push', traceId: '0123456789abcdef0123456789abcdef' as TraceId };

describe('投递状态机与退避', () => {
  test('退避 min(300, 5·2^n) 带 0.75–1.25 抖动', () => {
    expect(backoffSeconds(1, () => 0.5)).toBe(10);
    expect(backoffSeconds(3, () => 0)).toBe(30);
    expect(backoffSeconds(10, () => 1)).toBe(375);
  });

  test('pending → delivering → delivered；失败退避直到 dead；dead 才能重放并重新计数', () => {
    const d = newDelivery('dlv_1', event, { id: 'sbs_1', ...owner }, now);
    expect(d).toMatchObject({ state: 'pending', attempts: 0, nextAttemptAt: now });
    const first = beginAttempt(d, now);
    expect(first).toMatchObject({ state: 'delivering', attempts: 1 });
    expect(first.nextAttemptAt).toBeUndefined();
    const retrying = markFailed(first, 'HTTP 500', now, 2, () => 0.5);
    expect(retrying).toMatchObject({ state: 'retrying', lastError: 'HTTP 500', nextAttemptAt: new Date(now.getTime() + 10_000) });
    const second = beginAttempt(retrying, now);
    const dead = markFailed(second, 'HTTP 503', now, 2);
    expect(dead).toMatchObject({ state: 'dead', attempts: 2, lastError: 'HTTP 503' });
    expect(() => beginAttempt(dead, now)).toThrow();
    expect(() => replayDelivery(retrying, now)).toThrow();
    const replayed = replayDelivery(dead, now);
    expect(replayed).toMatchObject({ state: 'pending', attempts: 0, nextAttemptAt: now });
    expect(replayed.lastError).toBeUndefined();
    expect(markDelivered(beginAttempt(replayed, now), now)).toMatchObject({ state: 'delivered', attempts: 1, deliveredAt: now });
    // 崩溃遗留的 delivering 可以继续尝试
    expect(beginAttempt(first, now).attempts).toBe(2);
  });

  test('订阅对齐：同事件类型保留 id 并更新路径，新类型新建，未声明的移除，重复声明取第一条', () => {
    const existing = [
      { id: 'sbs_a', ...owner, eventType: 'gitlab.push', handlerPath: '/old', state: 'active' as const, updatedAt: now },
      { id: 'sbs_b', ...owner, eventType: 'gitlab.mr', handlerPath: '/mr', state: 'paused' as const, updatedAt: now },
    ];
    const declared = [{ eventType: 'gitlab.push', handlerPath: '/new' }, { eventType: 'gitlab.push', handlerPath: '/dup' }, { eventType: 'gitlab.tag', handlerPath: '/tag' }];
    let n = 0;
    const changes = reconcileSubscriptions(existing, declared, owner, () => `sbs_new${(n += 1)}`, now);
    expect(changes.upserts.map((s) => [s.id, s.eventType, s.handlerPath, s.state])).toEqual([['sbs_a', 'gitlab.push', '/new', 'active'], ['sbs_new1', 'gitlab.tag', '/tag', 'active']]);
    expect(changes.removedIds).toEqual(['sbs_b']);
  });
});
