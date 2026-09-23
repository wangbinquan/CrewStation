import type { ProjectId, ServiceId, TaskId, TaskKind, TraceId, UserId, VolumeMode } from '@crewstation/contracts';
import { DomainTopic } from '@crewstation/contracts';
import { conflict, newId, newTraceId, notFound, quotaExceeded, validation } from '@crewstation/kernel';
import { completeStage, failStartup, initialStartup } from '../domain/podStartup';
import { hashRunnerToken, newRunnerToken } from '../domain/runnerToken';
import type { TaskEnvironment } from '../domain/taskEnvironment';
import { podNameFor, pvcNameFor, transition } from '../domain/taskEnvironment';
import type { TaskPodSpec, TaskSourceCheckout } from '../ports/cluster';
import type { TaskRuntimeSettings } from '../ports/platform';
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

/** 开发预览的用户域主机与所需中间件；没有预览进程就不建路由。 */
export function previewRouteOf(settings: TaskRuntimeSettings, env: { preview?: unknown }, slug: string): { previewRoute?: TaskPodSpec['previewRoute'] } {
  if (!env.preview) return {};
  return {
    previewRoute: {
      host: `dev.${slug}.${settings.userDomain}`,
      userAuthMiddleware: settings.userAuthMiddleware,
      dropIdentityHeadersMiddleware: settings.dropIdentityHeadersMiddleware,
      systemNamespace: settings.systemNamespace,
    },
  };
}

/** 有分支的任务（开发会话）要把源码克隆进工作卷；没有分支或没配检出端口时不挂 init 容器。 */
export async function sourceOf(deps: TaskRuntimeUseCaseDeps, serviceId: ServiceId, branch: string | undefined): Promise<{ source?: TaskSourceCheckout }> {
  if (!branch || !deps.checkout) return {};
  const checkout = await deps.checkout.checkoutFor(serviceId, branch);
  return checkout ? { source: { ...checkout, branch } } : {};
}

/** 创建任务容器：配额原子准入→登记→建卷建 Pod；集群失败时回滚准入并标 failed，不留下无主 Pod。 */
export function createEnvironmentUseCase(deps: TaskRuntimeUseCaseDeps) {
  const { uow, cluster, quotas, profiles, services, settings, clock, logger } = deps;
  return async (input: CreateEnvironmentInput): Promise<TaskEnvironment> => {
    const svc = await services.resolveServiceById(input.serviceId);
    if (!svc) throw notFound('服务', input.serviceId);
    const selected = input.kind === 'dev-session' ? await profiles.devSessionProfile?.(svc.projectId) ?? settings.defaultProfile : input.profile ?? settings.defaultProfile;
    const profile = await profiles.getTaskProfile(selected);
    if (!profile) throw validation(`任务套餐 ${selected} 不存在`);
    const limit = await quotas.quotaLimit(svc.projectId);
    if (limit === undefined) throw validation('项目尚未配置并发任务配额');
    const volumeMode: VolumeMode = input.kind === 'dev-session' ? 'follow-container' : (input.volumeMode ?? 'follow-container');
    const token = newRunnerToken();
    const now = clock.now();
    const id = newId('tsk') as TaskId;
    const env: TaskEnvironment = {
      id, projectId: svc.projectId as ProjectId, serviceId: input.serviceId, kind: input.kind, state: 'creating', volumeMode, profile: profile.id,
      namespace: svc.namespace, podName: podNameFor(id), pvcName: pvcNameFor(id), traceId: input.traceId ?? (newTraceId() as TraceId), runnerTokenHash: hashRunnerToken(token),
      connected: false, ...(input.branch ? { branch: input.branch } : {}), ...(input.preview ? { preview: input.preview } : {}), labels: input.labels ?? {},
      ...(input.createdBy ? { createdBy: input.createdBy } : {}), createdAt: now, updatedAt: now, lastActivityAt: now,
      // 有分支且配了检出端口才有 init 容器（sourceOf）；检出端口没给出仓库时，观测按 Pod 里没有 init 容器跳过这一段。
      startup: initialStartup(now, input.branch && deps.checkout ? { checkout: input.branch } : {}),
    };
    await uow.run(async (scope) => {
      await scope.admissions.lock(svc.projectId);
      if (input.kind === 'dev-session' && (await scope.environments.findDevSession(svc.projectId))) throw conflict('该项目已有一个开发会话在运行', { projectId: svc.projectId });
      if (!(await scope.admissions.tryAcquire(svc.projectId, limit))) throw quotaExceeded(`并发任务已达配额上限 ${limit}`, { projectId: svc.projectId, limit });
      await scope.environments.insert(env);
      await scope.events.publish(DomainTopic.taskCreated, { occurredAt: now.toISOString(), traceId: env.traceId, projectId: env.projectId, serviceId: env.serviceId, taskId: env.id, kind: env.kind });
    });
    try {
      await cluster.ensureVolume(env, profile.storage);
      const podUid = await cluster.createPod({
        env, image: settings.taskImage, envVars: await containerEnv(deps, env, svc, token), resources: { cpu: profile.cpu, memory: profile.memory, storage: profile.storage },
        ...(await sourceOf(deps, env.serviceId, env.branch)), ...previewRouteOf(settings, env, svc.slug),
      });
      await recordPodInstance(deps, env, podUid);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('task pod creation failed', { taskId: id, error: message });
      const failedAt = clock.now();
      await uow.run(async (scope) => {
        await scope.environments.update(transition(env, 'failed', failedAt, { message, startup: failStartup(env.startup!, failedAt.toISOString(), { code: 'pod-create-failed', message }) }));
        await scope.admissions.release(svc.projectId);
      });
      throw error;
    }
    return env;
  };
}

/** Preserve concurrent Runner updates while binding the exact instance returned by Kubernetes. */
export async function recordPodInstance(deps: TaskRuntimeUseCaseDeps, env: TaskEnvironment, uid: string | void): Promise<void> {
  if (!uid) return;
  await deps.uow.run(async (scope) => {
    await scope.admissions.lock(env.projectId);
    const current = await scope.environments.getById(env.id);
    if (current?.podName !== env.podName || current.runnerTokenHash !== env.runnerTokenHash) return;
    // 建出 Pod 即「排队分配容器」结束（RFC-022）。
    await scope.environments.update({ ...current, podUid: uid, ...(current.startup ? { startup: completeStage(current.startup, 'queue', deps.clock.now().toISOString()) } : {}) });
  });
}
