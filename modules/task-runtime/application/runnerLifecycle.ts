import type { TaskId } from '@crewstation/contracts';
import { advanceStartup, failAtStage, runningStage } from '../domain/podStartup';
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
      // RFC-022：观测还没写到「等待连接」时，先按 Pod 自己记的时间补齐前几段，连上再收束；读不到就由收束兜底。
      const early = original.startup?.state === 'running' && runningStage(original.startup) !== 'connect'
        ? (await deps.cluster.observeStartup(original, { events: false }).catch(() => undefined))?.observation : undefined;
      return deps.uow.run(async (scope) => {
        await scope.admissions.lock(original.projectId);
        const env = await scope.environments.getById(taskId);
        if (!env || !['creating', 'running'].includes(env.state) || !tokenMatches(token, env.runnerTokenHash)) return false;
        if (env.native && !['starting', 'running'].includes(env.native.state)) return false;
        const record = env.rebuildId ? await scope.rebuilds.get(env.rebuildId) : undefined;
        if (record && !['starting', 'ready'].includes(record.state)) return false;
        const instance = !env.native && !env.podUid ? await deps.cluster.podPhase(env) : undefined;
        const now = deps.clock.now();
        const patch = { ...(instance?.uid ? { podUid: instance.uid } : {}), connected: true, lastActivityAt: now, updatedAt: now, ...(env.runnerRejection ? { runnerRejection: undefined, message: undefined } : {}), ...(env.native ? { native: { ...env.native, state: 'running' as const } } : {}) };
        const observed = env.startup && early ? { ...env, startup: advanceStartup(env.startup, early) } : env;
        await scope.environments.update(env.state === 'creating' ? transition(observed, 'running', now, { ...patch, message: '环境已连接' }) : { ...env, ...patch });
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
        // 握手被拒一定发生在等待连接这一段（RFC-022）：开发会话与业务任务的环境状态不变，启动进度记为失败。
        const startup = env.startup ? failAtStage(env.startup, 'connect', now.toISOString(), { code: 'runner-protocol-mismatch', message: rejection.message }) : undefined;
        const recorded = { ...env, connected: false, runnerRejection: { ...rejection, at: now.toISOString() }, message: rejection.message, updatedAt: now, ...(startup ? { startup } : {}) };
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
