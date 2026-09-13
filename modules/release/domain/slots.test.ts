import { expect, test } from 'bun:test';
import type { ReleaseId, ServiceId } from '@crewstation/contracts';
import { initialSlots, switchTraffic } from './slots';

const service = `svc_${'a'.repeat(32)}` as ServiceId, target = `rel_${'b'.repeat(32)}` as ReleaseId, later = `rel_${'c'.repeat(32)}` as ReleaseId, now = new Date('2026-09-13T01:00:00Z');
const ready = () => { const slots = initialSlots(service, now); return { ...slots, green: { ...slots.green, releaseId: target, state: 'ready' as const, replicas: 1, readyReplicas: 1 } }; };

test('首次上线明确确认空正式版本；后来已有版本时拒绝，不能把 null 当作未提供', () => {
  expect(switchTraffic(ready(), 'preview', null, now, target).active).toBe('green');
  const slots = ready();
  // 原判断只检查 truthy ID，null 被吞掉，首次上线的旧确认可覆盖已经上线的版本。
  expect(() => switchTraffic({ ...slots, blue: { ...slots.blue, releaseId: later } }, 'preview', null, now, target)).toThrow('当前线上发布已变化');
});

test('只允许切到确认过且仍就绪的目标；旧调用方省略确认字段保持兼容', () => {
  expect(() => switchTraffic(ready(), 'preview', undefined, now, later)).toThrow('待命发布已变化');
  const slots = ready();
  expect(() => switchTraffic({ ...slots, green: { ...slots.green, state: 'deploying' } }, 'preview', undefined, now, target)).toThrow('尚未就绪');
  expect(switchTraffic(ready(), 'preview', undefined, now).active).toBe('green');
});
