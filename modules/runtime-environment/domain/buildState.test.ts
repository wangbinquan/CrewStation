import { expect, test } from 'bun:test';
import { canTransitionBuild, occupiesBuildCapacity, transitionImageBuild } from './buildState';

test('取消必须等待物理停止，晚到构建成功不能复活已取消意图', () => {
  expect(canTransitionBuild('building', 'cancelling')).toBe(true);
  expect(canTransitionBuild('cancelling', 'succeeded')).toBe(false);
  expect(canTransitionBuild('cancelled', 'building')).toBe(false);
  expect(occupiesBuildCapacity('cancelling')).toBe(true);
  expect(occupiesBuildCapacity('cancelled')).toBe(false);
  expect(() => transitionImageBuild('succeeded', 'building')).toThrow('不能从');
});
test('登记已有镜像可以跳过构建但不能跳过检查，终态不可重新执行', () => {
  expect(canTransitionBuild('preparing', 'inspecting')).toBe(true);
  expect(canTransitionBuild('preparing', 'succeeded')).toBe(false);
  expect(transitionImageBuild('inspecting', 'succeeded')).toBe('succeeded');
  expect(canTransitionBuild('failed', 'queued')).toBe(false);
});
