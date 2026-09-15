import type { TaskId } from '@crewstation/contracts';
import { tokenMatches } from '../domain/runnerToken';
import { transition } from '../domain/taskEnvironment';
import type { TaskRuntimeUseCaseDeps } from './dependencies';

/** 回调携带本连接的令牌，在项目事务锁内再次核对，防止旧握手迟到。 */
export function runnerLifecycle(deps: TaskRuntimeUseCaseDeps) {
  return {
    onRunnerConnected: async (taskId: TaskId, token: string): Promise<boolean> => {
      const original = await deps.uow.read.environments.getById(taskId);
      if (!original) return false;
      return deps.uow.run(async (scope) => {
        await scope.admissions.lock(original.projectId);
        const env = await scope.environments.getById(taskId);
        if (!env || !['creating', 'running'].includes(env.state) || !tokenMatches(token, env.runnerTokenHash)) return false;
        const record = env.rebuildId ? await scope.rebuilds.get(env.rebuildId) : undefined;
        if (record && !['starting', 'ready'].includes(record.state)) return false;
        const now = deps.clock.now();
        await scope.environments.update(env.state === 'creating' ? transition(env, 'running', now, { connected: true, lastActivityAt: now, message: '环境已连接' }) : { ...env, connected: true, lastActivityAt: now, updatedAt: now });
        if (record?.state === 'starting') await scope.rebuilds.update({ ...record, state: 'ready', updatedAt: now, message: '原工作树已恢复；需要的 CLI 请逐个手动启动' });
        return true;
      });
    },
    onRunnerDisconnected: async (taskId: TaskId, token: string): Promise<void> => {
      const original = await deps.uow.read.environments.getById(taskId);
      if (!original) return;
      await deps.uow.run(async (scope) => {
        await scope.admissions.lock(original.projectId);
        const env = await scope.environments.getById(taskId);
        if (env?.connected && tokenMatches(token, env.runnerTokenHash)) await scope.environments.update({ ...env, connected: false, updatedAt: deps.clock.now() });
      });
    },
  };
}
