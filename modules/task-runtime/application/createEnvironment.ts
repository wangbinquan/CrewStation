import type { ProjectId, ServiceId, TaskId, TaskKind, TraceId, UserId, VolumeMode } from '@crewstation/contracts';
import { DomainTopic } from '@crewstation/contracts';
import { conflict, newId, newTraceId, notFound, quotaExceeded, validation } from '@crewstation/kernel';
import { hashRunnerToken, newRunnerToken } from '../domain/runnerToken';
import type { TaskEnvironment } from '../domain/taskEnvironment';
import { podNameFor, pvcNameFor, transition } from '../domain/taskEnvironment';
import { containerEnv } from './containerEnv';
import type { TaskRuntimeUseCaseDeps } from './dependencies';

export interface CreateEnvironmentInput {
  serviceId: ServiceId;
  kind: TaskKind;
  volumeMode?: VolumeMode;
  profile?: string;
  branch?: string;
  traceId?: TraceId;
  createdBy?: UserId;
  preview?: { command: string[]; port: number; healthPath: string };
  labels?: Record<string, string>;
}

/** 创建任务容器：配额原子准入→登记→建卷建 Pod；集群失败时回滚准入并标 failed，不留下无主 Pod。 */
export function createEnvironmentUseCase(deps: TaskRuntimeUseCaseDeps) {
  const { uow, cluster, quotas, profiles, services, settings, clock, logger } = deps;
  return async (input: CreateEnvironmentInput): Promise<TaskEnvironment> => {
    const svc = await services.resolveServiceById(input.serviceId);
    if (!svc) throw notFound('服务', input.serviceId);
    const profile = await profiles.getTaskProfile(input.profile ?? settings.defaultProfile);
    if (!profile) throw validation(`任务套餐 ${input.profile ?? settings.defaultProfile} 不存在`);
    const limit = await quotas.quotaLimit(svc.projectId);
    if (limit === undefined) throw validation('项目尚未配置并发任务配额');
    const volumeMode: VolumeMode = input.kind === 'dev-session' ? 'follow-container' : (input.volumeMode ?? 'follow-container');
    const token = newRunnerToken();
    const now = clock.now();
    const id = newId('tsk') as TaskId;
    const env: TaskEnvironment = {
      id, projectId: svc.projectId as ProjectId, serviceId: input.serviceId, kind: input.kind, state: 'creating', volumeMode, profile: profile.name,
      namespace: svc.namespace, podName: podNameFor(id), pvcName: pvcNameFor(id), traceId: input.traceId ?? (newTraceId() as TraceId), runnerTokenHash: hashRunnerToken(token),
      connected: false, ...(input.branch ? { branch: input.branch } : {}), ...(input.preview ? { preview: input.preview } : {}), labels: input.labels ?? {},
      ...(input.createdBy ? { createdBy: input.createdBy } : {}), createdAt: now, updatedAt: now, lastActivityAt: now,
    };
    await uow.run(async (scope) => {
      if (input.kind === 'dev-session' && (await scope.environments.findDevSession(svc.projectId))) throw conflict('该项目已有一个开发会话在运行', { projectId: svc.projectId });
      if (!(await scope.admissions.tryAcquire(svc.projectId, limit))) throw quotaExceeded(`并发任务已达配额上限 ${limit}`, { projectId: svc.projectId, limit });
      await scope.environments.insert(env);
      await scope.events.publish(DomainTopic.taskCreated, { occurredAt: now.toISOString(), traceId: env.traceId, projectId: env.projectId, serviceId: env.serviceId, taskId: env.id, kind: env.kind });
    });
    try {
      await cluster.ensureVolume(env, profile.storage);
      await cluster.createPod({ env, image: settings.taskImage, envVars: await containerEnv(deps, env, svc, token), resources: { cpu: profile.cpu, memory: profile.memory, storage: profile.storage }, ...(settings.agentEnvSecretName ? { agentEnvSecretName: settings.agentEnvSecretName } : {}) });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('task pod creation failed', { taskId: id, error: message });
      await uow.run(async (scope) => {
        await scope.environments.update(transition(env, 'failed', clock.now(), { message }));
        await scope.admissions.release(svc.projectId);
      });
      throw error;
    }
    return env;
  };
}
