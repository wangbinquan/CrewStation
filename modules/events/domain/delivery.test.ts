import { describe, expect, test } from 'bun:test';
import type { EventId, ProjectId, ServiceId, TraceId } from '@crewstation/contracts';
import { backoffSeconds } from './backoff';
import { beginAttempt, holdDelivery, markDelivered, markFailed, newDelivery, releaseHeldDelivery, replayDelivery } from './delivery';
import { reconcileSubscriptions } from './subscription';

const now = new Date('2026-09-11T00:00:00Z');
const owner = { serviceId: '01a0bf5d-8f4b-76c5-866c-f1feda3d63bb' as ServiceId, projectId: '01a0bf5d-8f4b-7178-82e1-9a99060b1192' as ProjectId };
const event = { id: '01a0bf5d-8f4b-7c44-8477-cc6c3fe31bee' as EventId, eventTypeId: '01a0bf5d-8f4b-796f-88f0-79a62633b947', eventType: 'gitlab.push', traceId: '0123456789abcdef0123456789abcdef' as TraceId };

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

  test('维护暂存（RFC-021）：待投、重试中、崩溃遗留的投递都可以暂存且不加尝试；只有暂存的能补发，补发后回到待投', () => {
    const d = newDelivery('dlv_h', event, { id: 'sbs_1', ...owner }, now);
    const held = holdDelivery(d, now);
    expect(held).toMatchObject({ state: 'held', attempts: 0 });
    expect(held.nextAttemptAt).toBeUndefined();
    const retrying = markFailed(beginAttempt(d, now), 'HTTP 502', now, 5, () => 0.5);
    expect(holdDelivery(retrying, now)).toMatchObject({ state: 'held', attempts: 1, lastError: 'HTTP 502' });
    expect(holdDelivery(beginAttempt(d, now), now)).toMatchObject({ state: 'held', attempts: 1 });
    expect(() => holdDelivery(markDelivered(beginAttempt(d, now), now), now)).toThrow('不能暂存');
    const later = new Date(now.getTime() + 60_000);
    expect(releaseHeldDelivery(held, later)).toMatchObject({ state: 'pending', attempts: 0, nextAttemptAt: later });
    expect(() => releaseHeldDelivery(d, later)).toThrow('不在暂存中');
    expect(() => beginAttempt(held, now)).toThrow();
  });

  test('订阅对齐：同事件类型保留 id 并更新路径，新类型新建，未声明的移除，重复声明取第一条', () => {
    const existing = [
      { id: 'sbs_a', ...owner, eventTypeId: '01a0bf5d-8f4b-796f-88f0-79a62633b947', eventType: 'gitlab.push', handlerPath: '/old', state: 'active' as const, updatedAt: now },
      { id: 'sbs_b', ...owner, eventTypeId: '01a0bf5d-8f4b-7b04-828c-4ba2d5beb150', eventType: 'gitlab.mr', handlerPath: '/mr', state: 'paused' as const, updatedAt: now },
    ];
    const declared = [{ eventTypeId: '01a0bf5d-8f4b-796f-88f0-79a62633b947', eventType: 'gitlab.push', handlerPath: '/new' }, { eventTypeId: '01a0bf5d-8f4b-796f-88f0-79a62633b947', eventType: 'gitlab.push', handlerPath: '/dup' }, { eventTypeId: '01a0bf5d-8f4b-714b-8098-264a0d4d4155', eventType: 'gitlab.tag', handlerPath: '/tag' }];
    let n = 0;
    const changes = reconcileSubscriptions(existing, declared, owner, () => `sbs_new${(n += 1)}`, now);
    expect(changes.upserts.map((s) => [s.id, s.eventType, s.handlerPath, s.state])).toEqual([['sbs_a', 'gitlab.push', '/new', 'active'], ['sbs_new1', 'gitlab.tag', '/tag', 'active']]);
    expect(changes.removedIds).toEqual(['sbs_b']);
  });
});
