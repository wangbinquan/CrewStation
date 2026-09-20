import type { TaskId } from '@crewstation/contracts';
import { tokenMatches } from '../domain/runnerToken';
import type { RunnerRejection } from '../domain/taskEnvironment';
import { transition } from '../domain/taskEnvironment';
import type { TaskRuntimeUseCaseDeps } from './dependencies';
import { scheduleExecutionCleanup } from './nativeExecution';

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
        if (env.native && !['starting', 'running'].includes(env.native.state)) return false;
        const record = env.rebuildId ? await scope.rebuilds.get(env.rebuildId) : undefined;
        if (record && !['starting', 'ready'].includes(record.state)) return false;
        const now = deps.clock.now();
        const patch = { connected: true, lastActivityAt: now, updatedAt: now, ...(env.runnerRejection ? { runnerRejection: undefined, message: undefined } : {}), ...(env.native ? { native: { ...env.native, state: 'running' as const } } : {}) };
        await scope.environments.update(env.state === 'creating' ? transition(env, 'running', now, { ...patch, message: '环境已连接' }) : { ...env, ...patch });
        if (record?.state === 'starting') await scope.rebuilds.update({ ...record, state: 'ready', updatedAt: now, message: '原工作树已恢复；需要的 CLI 请逐个手动启动' });
        return true;
      });
    },
    /**
     * 握手被拒（RFC-006 §5.3，协议不一致）：会话与业务任务只把原因记在环境上供页面与档位测试读取，不改状态、不删 Pod、
     * 不动工作卷——旧底座镜像里的开发会话可能还有未推送的工作。Agent 的执行环境起不来就是失败：回收本次 Pod 并释放额度，
     * 只影响这一个 Agent。同一原因重复握手不重复写。
     */
    onRunnerRejected: async (taskId: TaskId, token: string, rejection: Omit<RunnerRejection, 'at'>): Promise<void> => {
      const original = await deps.uow.read.environments.getById(taskId);
      if (!original) return;
      await deps.uow.run(async (scope) => {
        await scope.admissions.lock(original.projectId);
        const env = await scope.environments.getById(taskId);
        if (!env || !tokenMatches(token, env.runnerTokenHash) || env.runnerRejection?.message === rejection.message && !env.connected) return;
        const now = deps.clock.now();
        const recorded = { ...env, connected: false, runnerRejection: { ...rejection, at: now.toISOString() }, message: rejection.message, updatedAt: now };
        if (env.native && ['queued', 'starting'].includes(env.native.state)) await scheduleExecutionCleanup(scope, recorded, now, rejection.message);
        else await scope.environments.update(recorded);
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
