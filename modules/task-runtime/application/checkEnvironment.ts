import type { TaskId, TraceId } from '@crewstation/contracts';
import { newId, newTraceId, quotaExceeded, validation } from '@crewstation/kernel';
import { hashRunnerToken, newRunnerToken } from '../domain/runnerToken';
import { RUNTIME_CHECK_LABELS, RUNTIME_CHECK_MAX_CONCURRENT, RUNTIME_CHECK_PROJECT_ID, RUNTIME_CHECK_SERVICE_ID } from '../domain/runtimeCheckEnvironment';
import type { TaskEnvironment } from '../domain/taskEnvironment';
import { podNameFor, pvcNameFor, transition } from '../domain/taskEnvironment';
import { containerEnv } from './containerEnv';
import type { TaskRuntimeUseCaseDeps } from './dependencies';

/**
 * 创建一个运行环境检查任务：系统命名空间、默认任务套餐、无源码检出、无预览、不挂旧凭据文件。
 * Pod 标签键属于 k8s 适配层，由 wiring 连同平台归属值一起传入 labels。
 * 并发上限用哨兵项目的准入计数器保证；释放走普通 releaseEnvironment。
 */
export function createCheckEnvironmentUseCase(deps: TaskRuntimeUseCaseDeps) {
  const { uow, cluster, profiles, settings, clock, logger } = deps;
  return async (input: { createdBy?: string; labels?: Record<string, string> }): Promise<TaskEnvironment> => {
    const profile = await profiles.getTaskProfile(settings.defaultProfile);
    if (!profile) throw validation(`任务套餐 ${settings.defaultProfile} 不存在`);
    const token = newRunnerToken();
    const now = clock.now();
    const id = newId('tsk') as TaskId;
    const env: TaskEnvironment = {
      id, projectId: RUNTIME_CHECK_PROJECT_ID, serviceId: RUNTIME_CHECK_SERVICE_ID, kind: 'runtime-check', state: 'creating', volumeMode: 'follow-container', profile: profile.name,
      namespace: settings.systemNamespace, podName: podNameFor(id), pvcName: pvcNameFor(id), traceId: newTraceId() as TraceId, runnerTokenHash: hashRunnerToken(token), connected: false,
      labels: input.labels ?? {}, ...(input.createdBy ? { createdBy: input.createdBy as TaskEnvironment['createdBy'] } : {}),
      createdAt: now, updatedAt: now, lastActivityAt: now,
    };
    await uow.run(async (scope) => {
      await scope.admissions.lock(RUNTIME_CHECK_PROJECT_ID);
      if (!(await scope.admissions.tryAcquire(RUNTIME_CHECK_PROJECT_ID, RUNTIME_CHECK_MAX_CONCURRENT))) throw quotaExceeded(`同时进行的运行环境检查已达 ${RUNTIME_CHECK_MAX_CONCURRENT} 个，请稍后再试`);
      await scope.environments.insert(env);
    });
    try {
      await cluster.ensureVolume(env, profile.storage);
      await cluster.createPod({ env, image: settings.taskImage, envVars: await containerEnv(deps, env, { slug: RUNTIME_CHECK_LABELS.project, name: RUNTIME_CHECK_LABELS.service }, token), resources: { cpu: profile.cpu, memory: profile.memory, storage: profile.storage } });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('runtime check pod creation failed', { taskId: id, error: message });
      await uow.run(async (scope) => {
        await scope.environments.update(transition(env, 'failed', clock.now(), { message }));
        await scope.admissions.release(RUNTIME_CHECK_PROJECT_ID);
      });
      throw error;
    }
    return env;
  };
}
