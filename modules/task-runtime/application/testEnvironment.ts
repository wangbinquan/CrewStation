import type { TaskId, TraceId } from '@crewstation/contracts';
import { newId, newTraceId, quotaExceeded, validation } from '@crewstation/kernel';
import { failStartup, initialStartup } from '../domain/podStartup';
import { hashRunnerToken, newRunnerToken } from '../domain/runnerToken';
import { PROFILE_TEST_LABELS, PROFILE_TEST_MAX_CONCURRENT, PROFILE_TEST_PROJECT_ID, PROFILE_TEST_SERVICE_ID } from '../domain/profileTestEnvironment';
import type { TaskEnvironment } from '../domain/taskEnvironment';
import { podNameFor, pvcNameFor, transition } from '../domain/taskEnvironment';
import { recordPodInstance } from './createEnvironment';
import { containerEnv } from './containerEnv';
import type { TaskRuntimeUseCaseDeps } from './dependencies';

export interface TestEnvironmentInput {
  /** 档位修订按摘要固定的镜像：测试与真实启动拉同一份。 */
  image: string;
  /** 档位的资源套餐；不填用平台默认套餐。 */
  taskProfile?: string;
  labels?: Record<string, string>;
}

/**
 * 创建一个档位测试任务（RFC-006 §5.2、§6）：系统命名空间、档位的镜像与资源、空的临时工作目录、
 * 无源码检出、无预览、不带租户配置。Pod 标签键属于 k8s 适配层，由 wiring 连同平台归属值一起传入 labels。
 * 并发上限用哨兵项目的准入计数器保证；释放走普通 releaseEnvironment。
 */
export function createTestEnvironmentUseCase(deps: TaskRuntimeUseCaseDeps) {
  const { uow, cluster, profiles, settings, clock, logger } = deps;
  return async (input: TestEnvironmentInput): Promise<TaskEnvironment> => {
    const profileName = input.taskProfile ?? settings.defaultProfile;
    const profile = await profiles.getTaskProfile(profileName);
    if (!profile) throw validation(`任务套餐 ${profileName} 不存在`, { code: 'task_profile_not_found', taskProfile: profileName });
    const token = newRunnerToken();
    const now = clock.now();
    const id = newId('tsk') as TaskId;
    const env: TaskEnvironment = {
      id, projectId: PROFILE_TEST_PROJECT_ID, serviceId: PROFILE_TEST_SERVICE_ID, kind: 'profile-test', state: 'creating', volumeMode: 'follow-container', profile: profile.id,
      namespace: settings.systemNamespace, podName: podNameFor(id), pvcName: pvcNameFor(id), traceId: newTraceId() as TraceId, runnerTokenHash: hashRunnerToken(token), connected: false,
      labels: input.labels ?? {}, createdAt: now, updatedAt: now, lastActivityAt: now, startup: initialStartup(now),
    };
    await uow.run(async (scope) => {
      await scope.admissions.lock(PROFILE_TEST_PROJECT_ID);
      if (!(await scope.admissions.tryAcquire(PROFILE_TEST_PROJECT_ID, PROFILE_TEST_MAX_CONCURRENT))) throw quotaExceeded(`同时进行的档位测试已达 ${PROFILE_TEST_MAX_CONCURRENT} 个，请稍后重测`);
      await scope.environments.insert(env);
    });
    try {
      const envVars = await containerEnv(deps, env, { slug: PROFILE_TEST_LABELS.project, name: PROFILE_TEST_LABELS.service }, token);
      const podUid = await cluster.createPod({ env, image: input.image, envVars, resources: { cpu: profile.cpu, memory: profile.memory, storage: profile.storage }, workVolume: 'emptyDir' });
      await recordPodInstance(deps, env, podUid);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('profile test pod creation failed', { taskId: id, error: message });
      const failedAt = clock.now();
      await uow.run(async (scope) => {
        await scope.environments.update(transition(env, 'failed', failedAt, { message, startup: failStartup(env.startup!, failedAt.toISOString(), { code: 'pod-create-failed', message }) }));
        await scope.admissions.release(PROFILE_TEST_PROJECT_ID);
      });
      throw error;
    }
    return env;
  };
}
