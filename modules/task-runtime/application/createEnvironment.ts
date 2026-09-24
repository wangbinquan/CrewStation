import type { ProjectId, ServiceId, TaskId, TaskKind, TraceId, UserId, VolumeMode } from '@crewstation/contracts';
import { DomainTopic } from '@crewstation/contracts';
import { conflict, newId, newTraceId, notFound, validation } from '@crewstation/kernel';
import { completeStage, failStartup, initialStartup } from '../domain/podStartup';
import { hashRunnerToken, newRunnerToken } from '../domain/runnerToken';
import type { TaskEnvironment, WorkloadRender } from '../domain/taskEnvironment';
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

/** 资源中心建出容器时的期望（RFC-025 I25）：镜像、资源、检出与开发预览路由；凭据不在这里。 */
function workloadRenderOf(settings: TaskRuntimeSettings, profile: { cpu: string; memory: string; storage: string }, source: TaskSourceCheckout | undefined, previewRoute: TaskPodSpec['previewRoute']): WorkloadRender {
  return {
    image: settings.taskImage, workerUid: settings.workerUid, resources: { cpu: profile.cpu, memory: profile.memory, storage: profile.storage }, start: 1,
    ...(source ? { checkout: { repoUrl: source.repoUrl, branch: source.branch, credentialSecretName: source.credentialSecretName } } : {}),
    ...(previewRoute ? { previewRoute: { host: previewRoute.host, middlewares: [{ name: previewRoute.dropIdentityHeadersMiddleware, namespace: previewRoute.systemNamespace }, { name: previewRoute.userAuthMiddleware, namespace: previewRoute.systemNamespace }] } } : {}),
  };
}

/**
 * 创建任务容器：配额原子准入→登记→建卷建 Pod；集群失败时回滚准入并标 failed，不留下无主 Pod。
 * 由资源中心建出时（RFC-025 I25）只到登记为止：期望随记录进台账，调和器照它建卷、Runner Secret、Pod 与预览。
 */
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
    // 由资源中心建出（I25）：只到登记为止，期望随记录进台账，卷、Runner Secret、Pod 与预览由调和器照它建。
    const rendered = deps.creation === 'ledger' ? { ...env, render: workloadRenderOf(settings, profile, (await sourceOf(deps, input.serviceId, input.branch)).source, previewRouteOf(settings, env, svc.slug).previewRoute) } : undefined;
    await admit(deps, rendered ?? env, limit);
    if (rendered) return rendered;
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
        await scope.quota.release(env);
      });
      throw error;
    }
    return env;
  };
}

/** 配额准入与登记同一事务（一个项目一个开发会话）；配了台账时记录随之进台账。 */
async function admit(deps: TaskRuntimeUseCaseDeps, env: TaskEnvironment, limit: number): Promise<void> {
  await deps.uow.run(async (scope) => {
    await scope.admissions.lock(env.projectId);
    if (env.kind === 'dev-session' && (await scope.environments.findDevSession(env.projectId))) throw conflict('该项目已有一个开发会话在运行', { projectId: env.projectId });
    await scope.quota.acquire(env, limit, `并发任务已达配额上限 ${limit}`);
    await scope.environments.insert(env);
    await scope.events.publish(DomainTopic.taskCreated, { occurredAt: env.createdAt.toISOString(), traceId: env.traceId, projectId: env.projectId, serviceId: env.serviceId, taskId: env.id, kind: env.kind });
  });
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
