import { expect, test } from 'bun:test';
import type { TaskEnvironment } from './taskEnvironment';
import { POD_CREATE_GRACE_MS, awaitingPodCreation } from './taskEnvironment';

const createdAt = new Date('2026-09-23T10:05:16.396Z');
const env = (patch: Partial<TaskEnvironment> = {}) => ({ state: 'creating', createdAt, ...patch }) as TaskEnvironment;
const after = (ms: number) => new Date(createdAt.getTime() + ms);

test('还在建 Pod：刚创建、没记下 Pod 实例的环境在宽限内算「还在建」，超过宽限、记下实例或已不在创建中都不算', () => {
  expect(POD_CREATE_GRACE_MS).toBe(120_000);
  // 2026-09-23 实机：记录提交后 0.25 秒被每秒一次的启动观测扫到，Pod 还没建出来。
  expect(awaitingPodCreation(env(), after(250))).toBe(true);
  expect(awaitingPodCreation(env(), after(POD_CREATE_GRACE_MS - 1))).toBe(true);
  expect(awaitingPodCreation(env(), after(POD_CREATE_GRACE_MS))).toBe(false);
  expect(awaitingPodCreation(env({ podUid: 'uid-1' }), after(250))).toBe(false);
  expect(awaitingPodCreation(env({ state: 'running' }), after(250))).toBe(false);
  // 执行环境与重建在建好 Pod 之后才进入可判定状态，不走这条宽限。
  expect(awaitingPodCreation(env({ native: { state: 'starting' } as TaskEnvironment['native'] }), after(250))).toBe(false);
  expect(awaitingPodCreation(env({ rebuildId: 'rebuild-1' as TaskEnvironment['rebuildId'] }), after(250))).toBe(false);
});
