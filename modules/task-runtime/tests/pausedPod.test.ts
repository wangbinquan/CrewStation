import { expect, test } from 'bun:test';
import { waitForPausedPodRemoval } from '../application/pausedPod';
import type { TaskEnvironment } from '../domain/taskEnvironment';

test('finalizer 超时仍返回可重试的暂停原因，旧实例消失后才允许恢复', async () => {
  const env = { podUid: 'original' } as TaskEnvironment;
  let removed = false;
  const cluster = { podPhase: async () => removed ? { phase: 'Missing' as const } : { phase: 'Running' as const, uid: 'original' } };
  await expect(waitForPausedPodRemoval(cluster, env, { timeoutMs: 0, pollMs: 0 })).rejects.toThrow('原 Pod 仍在删除');
  removed = true;
  await expect(waitForPausedPodRemoval(cluster, env)).resolves.toBeUndefined();
});

test('历史任务没有原 Pod UID 时，不能将同名运行实例视作可恢复的旧对象', async () => {
  await expect(waitForPausedPodRemoval({ podPhase: async () => ({ phase: 'Running', uid: 'unbound' }) }, {} as TaskEnvironment)).rejects.toThrow('实例已变化');
});
