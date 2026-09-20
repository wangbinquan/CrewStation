import type { TaskId } from '@crewstation/contracts';
import { DomainTopic } from '@crewstation/contracts';
import { notFound, precondition } from '@crewstation/kernel';
import { hashRunnerToken, newRunnerToken } from '../domain/runnerToken';
import type { TaskEnvironment } from '../domain/taskEnvironment';
import { canPause, occupiesQuota, transition } from '../domain/taskEnvironment';
import { containerEnv } from './containerEnv';
import { previewRouteOf, recordPodInstance, sourceOf } from './createEnvironment';
import type { TaskRuntimeUseCaseDeps } from './dependencies';
import { runnerLifecycle } from './runnerLifecycle';
import { failEnvironment } from './failEnvironment';
import { rebuildIsActive } from '../domain/environmentRebuild';
import { deferWorkspaceRelease, scheduleExecutionCleanup } from './nativeExecution';
import { waitForPausedPodRemoval } from './pausedPod';

export type ReleaseReason = 'user' | 'owner-force' | 'business' | 'failed' | 'pod-lost' | 'profile-test';

/** 运行、释放、暂停、恢复与连接回调；释放即回收 Pod、跟随卷与配额（R14、R29）。 */
export function lifecycleUseCases(deps: TaskRuntimeUseCaseDeps) {
  const { uow, cluster, services, settings, clock, logger } = deps;
  const load = async (taskId: TaskId): Promise<TaskEnvironment> => {
    const env = await uow.read.environments.getById(taskId);
    if (!env) throw notFound('任务', taskId);
    return env;
  };

  const releaseEnvironment = async (taskId: TaskId, reason: ReleaseReason): Promise<TaskEnvironment> => {
    const original = await load(taskId);
    const env = await uow.run(async (scope) => {
      await scope.admissions.lock(original.projectId);
      const current = (await scope.environments.getById(taskId))!;
      if (current.state === 'released') return current;
      const rebuild = current.rebuildId ? await scope.rebuilds.get(current.rebuildId) : undefined;
      if (rebuild && rebuildIsActive(rebuild)) throw precondition('环境正在重建，请等待完成后再释放');
      const deferred = await deferWorkspaceRelease(scope, current, clock.now(), reason);
      if (deferred) return deferred;
      if (current.state === 'releasing') throw precondition('环境正在释放，请稍后查看');
      await scope.environments.update(transition(current, 'releasing', clock.now(), { connected: false }));
      return current;
    });
    if (env.state === 'released' || env.native || env.release) return env;
    const occupied = occupiesQuota(env.state);
    const releasing = transition(env, 'releasing', clock.now(), { connected: false });
    await cluster.deletePod(env);
    if (env.volumeMode === 'follow-container') await cluster.deleteVolume(env);
    const now = clock.now();
    const released = transition(releasing, 'released', now, { message: `released: ${reason}` });
    await uow.run(async (scope) => {
      await scope.environments.update(released);
      if (occupied) await scope.admissions.release(env.projectId);
      await scope.events.publish(DomainTopic.taskReleased, { occurredAt: now.toISOString(), traceId: env.traceId, projectId: env.projectId, taskId: env.id, kind: env.kind, reason });
    });
    logger.info('task released', { taskId, reason });
    return released;
  };

  return {
    releaseEnvironment,
    ...runnerLifecycle(deps),
    markFailed: failEnvironment(deps),
    touch: async (taskId: TaskId): Promise<void> => {
      const original = await load(taskId);
      await uow.run(async (scope) => {
        await scope.admissions.lock(original.projectId);
        const env = (await scope.environments.getById(taskId))!;
        // 活动心跳不改变环境修订；否则用户确认恢复时的点击会使刚检查过的快照过期。
        if (env.state === 'running') await scope.environments.update({ ...env, lastActivityAt: clock.now() });
      });
    },
    pauseEnvironment: pauseEnvironmentUseCase(deps, load),
    resumeEnvironment: async (taskId: TaskId): Promise<TaskEnvironment> => {
      const env = await load(taskId);
      if (env.state !== 'paused') throw precondition('只有暂停中的任务可以恢复');
      const svc = await services.resolveServiceById(env.serviceId);
      if (!svc) throw notFound('服务', env.serviceId);
      const profile = await deps.profiles.getTaskProfile(env.profile);
      if (!profile) throw precondition(`任务套餐 ${env.profile} 已不存在`);
      await waitForPausedPodRemoval(cluster, env);
      const limit = (await deps.quotas.quotaLimit(env.projectId)) ?? 0;
      const token = newRunnerToken();
      const resumed = transition(env, 'creating', clock.now(), { runnerTokenHash: hashRunnerToken(token), connected: false, podUid: undefined });
      await uow.run(async (scope) => {
        if (!(await scope.admissions.tryAcquire(env.projectId, limit))) throw precondition(`并发任务已达配额上限 ${limit}`);
        await scope.environments.update(resumed);
      });
      const podUid = await cluster.createPod({
        env: resumed, image: settings.taskImage, envVars: await containerEnv(deps, resumed, svc, token), resources: { cpu: profile.cpu, memory: profile.memory, storage: profile.storage },
        ...(await sourceOf(deps, resumed.serviceId, resumed.branch)), ...previewRouteOf(settings, resumed, svc.slug),
      });
      await recordPodInstance(deps, resumed, podUid);
      return resumed;
    },
  };
}

/** 暂停业务任务：先结束任务内全部 Agent 执行环境（恢复时不重起，RFC-006 P7），再删容器、释放额度。 */
function pauseEnvironmentUseCase(deps: TaskRuntimeUseCaseDeps, load: (taskId: TaskId) => Promise<TaskEnvironment>) {
  const { uow, cluster, clock } = deps;
  return async (taskId: TaskId): Promise<TaskEnvironment> => {
    const env = await load(taskId);
    if (!canPause(env)) throw precondition('只有持久卷模式的运行中业务任务可以暂停');
    // 暂停时结束任务内全部 Agent 执行环境，恢复时不重起（RFC-006 P7）；子任务按「执行环境已结束」收尾。
    await uow.run(async (scope) => {
      await scope.admissions.lock(env.projectId);
      for (const child of await scope.environments.listChildren(env.id)) {
        if (child.native && child.native.state !== 'finished') await scheduleExecutionCleanup(scope, child, clock.now(), '业务任务已暂停，此子任务的执行环境随之结束');
      }
    });
    await cluster.deletePod(env);
    const paused = transition(env, 'paused', clock.now(), { connected: false });
    await uow.run(async (scope) => { await scope.environments.update(paused); await scope.admissions.release(env.projectId); });
    return paused;
  };
}
