import type { StartupErrorCode, TaskId } from '@crewstation/contracts';
import { maskDiagnosticsText } from '../domain/diagnosticsText';
import { CHECKOUT_CONTAINER, advanceStartup, defaultFailureCode, failStartup, failureCode, runningStage } from '../domain/podStartup';
import { hashRunnerToken, newRunnerToken } from '../domain/runnerToken';
import { rebuildIsActive } from '../domain/environmentRebuild';
import { occupiesQuota, transition } from '../domain/taskEnvironment';
import type { EnvironmentState, TaskEnvironment } from '../domain/taskEnvironment';
import type { TaskRuntimeUseCaseDeps } from './dependencies';
import { scheduleExecutionCleanup } from './nativeExecution';

/** RFC-022：判定失败时留下的日志尾部读哪个容器——检出失败读 init 容器，等待连接读主容器；之前的段还没有容器日志。 */
export async function startupLogTail(deps: TaskRuntimeUseCaseDeps, env: TaskEnvironment, container?: string): Promise<string | undefined> {
  const kind = runningStage(env.startup);
  const target = container ?? (kind === 'checkout' ? CHECKOUT_CONTAINER : kind === 'connect' ? env.podName : undefined);
  if (!target) return undefined;
  const raw = await deps.cluster.tailLog(env, target, 100).catch(() => undefined);
  return raw?.trim() ? maskDiagnosticsText(raw).slice(-16_384) : undefined;
}

export function failEnvironment(deps: TaskRuntimeUseCaseDeps) {
  return async (taskId: TaskId, message: string, expectedPodName?: string, expectedState?: EnvironmentState, code?: StartupErrorCode): Promise<void> => {
    const original = await deps.uow.read.environments.getById(taskId);
    if (!original) return;
    // 先按 Pod 自己记的时间把启动进度推到出事的那一段（例如检出在一秒内就失败了），再留下那一段相关容器的日志：
    // 执行环境判失败后立即回收，Pod 删掉就读不到了，所以都在进事务之前做。
    const observation = original.startup?.state === 'running' ? (await deps.cluster.observeStartup(original, { events: false }).catch(() => undefined))?.observation : undefined;
    const advance = (env: TaskEnvironment): TaskEnvironment['startup'] => (env.startup && observation ? advanceStartup(env.startup, observation) : env.startup);
    const logTail = original.startup?.state === 'running' ? await startupLogTail(deps, { ...original, startup: advance(original) }) : undefined;
    await deps.uow.run(async (scope) => {
      await scope.admissions.lock(original.projectId);
      const current = await scope.environments.getById(taskId);
      if (!current || ['released', 'failed', 'releasing'].includes(current.state) || (expectedPodName && expectedPodName !== current.podName)) return;
      if (expectedState && current.state !== expectedState) return;
      const now = deps.clock.now();
      const startup = advance(current);
      const env = startup ? { ...current, startup: failStartup(startup, now.toISOString(), { code: failureCode(startup, code ?? defaultFailureCode(startup)), message }, logTail) } : current;
      if (env.native) { await scheduleExecutionCleanup(scope, env, now, message); return; }
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
