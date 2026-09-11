import type { TaskId } from '@crewstation/contracts';
import { DomainTopic } from '@crewstation/contracts';
import { notFound, precondition } from '@crewstation/kernel';
import { hashRunnerToken, newRunnerToken } from '../domain/runnerToken';
import type { TaskEnvironment } from '../domain/taskEnvironment';
import { canPause, occupiesQuota, transition } from '../domain/taskEnvironment';
import { containerEnv } from './containerEnv';
import { previewRouteOf, sourceOf } from './createEnvironment';
import type { TaskRuntimeUseCaseDeps } from './dependencies';

export type ReleaseReason = 'user' | 'owner-force' | 'business' | 'failed' | 'pod-lost';

/** 运行、释放、暂停、恢复与连接回调；释放即回收 Pod、跟随卷与配额（R14、R29）。 */
export function lifecycleUseCases(deps: TaskRuntimeUseCaseDeps) {
  const { uow, cluster, services, settings, clock, logger } = deps;
  const load = async (taskId: TaskId): Promise<TaskEnvironment> => {
    const env = await uow.read.environments.getById(taskId);
    if (!env) throw notFound('任务', taskId);
    return env;
  };
  const save = (env: TaskEnvironment): Promise<void> => uow.run((scope) => scope.environments.update(env));

  const releaseEnvironment = async (taskId: TaskId, reason: ReleaseReason): Promise<TaskEnvironment> => {
    const env = await load(taskId);
    if (env.state === 'released') return env;
    const occupied = occupiesQuota(env.state);
    const releasing = transition(env, 'releasing', clock.now(), { connected: false });
    await save(releasing);
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
    onRunnerConnected: async (taskId: TaskId): Promise<void> => {
      const env = await load(taskId);
      const now = clock.now();
      await save(env.state === 'creating' ? transition(env, 'running', now, { connected: true, lastActivityAt: now }) : { ...env, connected: true, lastActivityAt: now, updatedAt: now });
    },
    onRunnerDisconnected: async (taskId: TaskId): Promise<void> => {
      const env = await uow.read.environments.getById(taskId);
      if (env && env.connected) await save({ ...env, connected: false, updatedAt: clock.now() });
    },
    touch: async (taskId: TaskId): Promise<void> => {
      const env = await load(taskId);
      await save({ ...env, lastActivityAt: clock.now(), updatedAt: clock.now() });
    },
    markFailed: async (taskId: TaskId, message: string): Promise<void> => {
      const env = await load(taskId);
      if (env.state === 'released' || env.state === 'failed') return;
      const failed = transition(env, 'failed', clock.now(), { message, connected: false });
      await uow.run(async (scope) => {
        await scope.environments.update(failed);
        if (occupiesQuota(env.state)) await scope.admissions.release(env.projectId);
      });
    },
    pauseEnvironment: async (taskId: TaskId): Promise<TaskEnvironment> => {
      const env = await load(taskId);
      if (!canPause(env)) throw precondition('只有持久卷模式的运行中业务任务可以暂停');
      await cluster.deletePod(env);
      const paused = transition(env, 'paused', clock.now(), { connected: false });
      await uow.run(async (scope) => { await scope.environments.update(paused); await scope.admissions.release(env.projectId); });
      return paused;
    },
    resumeEnvironment: async (taskId: TaskId): Promise<TaskEnvironment> => {
      const env = await load(taskId);
      if (env.state !== 'paused') throw precondition('只有暂停中的任务可以恢复');
      const svc = await services.resolveServiceById(env.serviceId);
      if (!svc) throw notFound('服务', env.serviceId);
      const profile = await deps.profiles.getTaskProfile(env.profile);
      if (!profile) throw precondition(`任务套餐 ${env.profile} 已不存在`);
      const limit = (await deps.quotas.quotaLimit(env.projectId)) ?? 0;
      const token = newRunnerToken();
      const resumed = transition(env, 'creating', clock.now(), { runnerTokenHash: hashRunnerToken(token), connected: false });
      await uow.run(async (scope) => {
        if (!(await scope.admissions.tryAcquire(env.projectId, limit))) throw precondition(`并发任务已达配额上限 ${limit}`);
        await scope.environments.update(resumed);
      });
      await cluster.createPod({
        env: resumed, image: settings.taskImage, envVars: await containerEnv(deps, resumed, svc, token), resources: { cpu: profile.cpu, memory: profile.memory, storage: profile.storage },
        ...(settings.agentEnvSecretName ? { agentEnvSecretName: settings.agentEnvSecretName } : {}), ...(await sourceOf(deps, resumed.serviceId, resumed.branch)), ...previewRouteOf(settings, resumed, svc.slug),
      });
      return resumed;
    },
  };
}
