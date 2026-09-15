import type { TaskId } from '@crewstation/contracts';
import { hashRunnerToken, newRunnerToken } from '../domain/runnerToken';
import { rebuildIsActive } from '../domain/environmentRebuild';
import { occupiesQuota, transition } from '../domain/taskEnvironment';
import type { EnvironmentState } from '../domain/taskEnvironment';
import type { TaskRuntimeUseCaseDeps } from './dependencies';

export function failEnvironment(deps: TaskRuntimeUseCaseDeps) {
  return async (taskId: TaskId, message: string, expectedPodName?: string, expectedState?: EnvironmentState): Promise<void> => {
    const original = await deps.uow.read.environments.getById(taskId);
    if (!original) return;
    await deps.uow.run(async (scope) => {
      await scope.admissions.lock(original.projectId);
      const env = await scope.environments.getById(taskId);
      if (!env || ['released', 'failed', 'releasing'].includes(env.state) || (expectedPodName && expectedPodName !== env.podName)) return;
      if (expectedState && env.state !== expectedState) return;
      const now = deps.clock.now();
      const record = env.rebuildId ? await scope.rebuilds.get(env.rebuildId) : undefined;
      if (record && rebuildIsActive(record)) {
        // 尚在准备新 Pod 时，对账看见 Missing 不是失败；启动失败则先补偿后释放配额。
        if (record.state !== 'starting') return;
        await scope.rebuilds.update({ ...record, state: 'replacing', failureReason: message, message, updatedAt: now });
        await scope.environments.update({ ...env, connected: false, runnerTokenHash: hashRunnerToken(newRunnerToken()), updatedAt: now });
        await scope.rebuildQueue.enqueue(record.id);
        return;
      }
      await scope.environments.update(transition(env, 'failed', now, { message, connected: false }));
      if (occupiesQuota(env.state)) await scope.admissions.release(env.projectId);
    });
  };
}
