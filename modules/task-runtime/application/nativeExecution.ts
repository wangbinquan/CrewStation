import type { TaskId } from '@crewstation/contracts';
import { DomainTopic } from '@crewstation/contracts';
import { conflict, notFound, precondition, quotaExceeded } from '@crewstation/kernel';
import type { CreateNativeExecutionInput, ReleaseReason } from '../api/moduleApi';
import { hashRunnerToken, newRunnerToken } from '../domain/runnerToken';
import type { NativeExecution, TaskEnvironment } from '../domain/taskEnvironment';
import { occupiesQuota, transition } from '../domain/taskEnvironment';
import type { NativeExecutionCluster } from '../ports/cluster';
import type { RepositoryScope } from '../ports/unitOfWork';
import type { TaskRuntimeUseCaseDeps } from './dependencies';
import { containerEnv } from './containerEnv';

export type NativeExecutionDeps = TaskRuntimeUseCaseDeps & { nativeCluster: NativeExecutionCluster };
export type ExecutionLease = () => Promise<boolean>;
export const requireExecutionLease = async (heartbeat: ExecutionLease) => { if (!await heartbeat()) throw new Error('CLI 执行作业租约已被接管'); };

function sameRequest(env: TaskEnvironment, input: CreateNativeExecutionInput): boolean {
  const n = env.native;
  return !!n && n.parentTaskId === input.parentTaskId && env.createdBy === input.createdBy && n.agentId === input.agentId
    && n.terminalId === input.terminalId && n.runnerId === input.runnerId && n.fingerprint === input.fingerprint && n.requestedProfile === (input.profile ?? null);
}

/** 受理只登记意图。配额、不可变执行身份与队列在同一项目事务中提交。 */
export function createNativeExecutionUseCase(deps: NativeExecutionDeps) {
  return async (input: CreateNativeExecutionInput): Promise<TaskEnvironment> => {
    const original = await deps.uow.read.environments.getById(input.parentTaskId);
    if (!original) throw notFound('开发会话', input.parentTaskId);
    return deps.uow.run(async (scope) => {
      await scope.admissions.lock(original.projectId);
      const previous = await scope.environments.getById(input.id);
      if (previous) {
        if (!sameRequest(previous, input)) throw conflict('该 CLI 执行标识已用于另一份启动配置');
        return previous;
      }
      const parent = await scope.environments.getById(input.parentTaskId);
      if (!parent || parent.native || parent.kind !== 'dev-session' || parent.state !== 'running' || !parent.connected) throw precondition('工作区未连接或正在释放，不能新增 CLI');
      const profile = await deps.profiles.getTaskProfile(input.profile ?? deps.settings.defaultProfile);
      if (!profile) throw precondition('管理员指定的 CLI 任务套餐不存在，请联系管理员调整算力档位');
      const workspace = await deps.nativeCluster.inspectWorkspace(parent);
      const limit = (await deps.quotas.quotaLimit(parent.projectId)) ?? 0;
      if (!await scope.admissions.tryAcquire(parent.projectId, limit)) throw quotaExceeded('项目并发额度已满，本次 CLI 未启动，已有窗口保持运行');
      const now = deps.clock.now();
      const native: NativeExecution = { parentTaskId: parent.id, parentPodUid: workspace.podUid, pvcUid: workspace.pvcUid, nodeName: workspace.nodeName,
        agentId: input.agentId, terminalId: input.terminalId, runnerId: input.runnerId, fingerprint: input.fingerprint, requestedProfile: input.profile ?? null,
        profile: { name: profile.name, cpu: profile.cpu, memory: profile.memory, storage: profile.storage }, image: deps.settings.taskImage, state: 'queued' };
      const env: TaskEnvironment = { id: input.id, projectId: parent.projectId, serviceId: parent.serviceId, kind: 'dev-session', state: 'creating',
        volumeMode: 'persistent', profile: profile.name, namespace: parent.namespace, podName: `cli-${input.id.slice(4)}`, pvcName: parent.pvcName,
        traceId: parent.traceId, runnerTokenHash: hashRunnerToken(newRunnerToken()), connected: false, labels: parent.labels, createdBy: input.createdBy,
        native, message: '已受理，正在准备独立 CLI 环境', createdAt: now, updatedAt: now, lastActivityAt: now };
      await scope.environments.insert(env);
      await scope.nativeQueue.enqueue(env.id);
      return env;
    });
  };
}

/** 清理意图先持久化并失效凭据；卷、原开发容器和其他 CLI 不参与此状态迁移。 */
export async function scheduleExecutionCleanup(scope: RepositoryScope, env: TaskEnvironment, now: Date, failureReason?: string): Promise<TaskEnvironment> {
  if (!env.native || env.native.state === 'finished') return env;
  const next: TaskEnvironment = { ...env, state: 'releasing', native: { ...env.native, state: 'cleaning', ...(failureReason ? { failureReason } : {}) },
    runnerTokenHash: hashRunnerToken(newRunnerToken()), connected: false, message: failureReason ?? 'CLI 已结束，正在回收执行环境', updatedAt: now };
  await scope.environments.update(next);
  await scope.nativeQueue.enqueue(env.id);
  return next;
}

export async function deferWorkspaceRelease(scope: RepositoryScope, env: TaskEnvironment, now: Date, reason: ReleaseReason): Promise<TaskEnvironment | undefined> {
  if (env.native) return scheduleExecutionCleanup(scope, env, now);
  if (env.state === 'releasing' && env.release) { await scope.nativeQueue.enqueue(env.id); return env; }
  const children = (await scope.environments.listChildren(env.id)).filter((child) => child.native?.state !== 'finished');
  if (!children.length) return undefined;
  const releasing = transition(env, 'releasing', now, { connected: false, release: { reason, occupied: occupiesQuota(env.state) }, message: '正在结束 CLI 并释放工作区' });
  await scope.environments.update(releasing);
  for (const child of children) await scheduleExecutionCleanup(scope, child, now);
  await scope.nativeQueue.enqueue(env.id);
  return releasing;
}

export async function prepareNativeExecution(deps: NativeExecutionDeps, scope: RepositoryScope, env: TaskEnvironment, heartbeat: ExecutionLease): Promise<void> {
  const n = env.native!;
  const parent = await scope.environments.getById(n.parentTaskId);
  if (!parent || parent.state !== 'running' || !parent.connected) throw precondition('原工作区已经断开或释放，本次 CLI 未启动');
  const verifyWorkspace = async () => {
    const workspace = await deps.nativeCluster.inspectWorkspace(parent);
    if (workspace.podUid !== n.parentPodUid || workspace.pvcUid !== n.pvcUid || workspace.nodeName !== n.nodeName) throw precondition('启动期间原工作区实例或工作卷已变化，本次 CLI 未启动');
  };
  await requireExecutionLease(heartbeat);
  await verifyWorkspace();
  const svc = await deps.services.resolveServiceById(env.serviceId);
  if (!svc) throw precondition('CLI 所属服务已不存在');
  const prepared = await deps.nativeCluster.prepare(env, () => containerEnv(deps, env, svc, newRunnerToken()));
  await verifyWorkspace();
  await requireExecutionLease(heartbeat);
  const now = deps.clock.now();
  await scope.environments.update({ ...env, runnerTokenHash: hashRunnerToken(prepared.token), updatedAt: now,
    native: { ...n, state: 'starting', podUid: prepared.podUid, secretUid: prepared.secretUid, preparedAt: now.toISOString() }, message: '独立 CLI 容器已创建，等待调度和连接' });
}

export async function cleanupNativeExecution(deps: NativeExecutionDeps, scope: RepositoryScope, env: TaskEnvironment, heartbeat: ExecutionLease): Promise<void> {
  await requireExecutionLease(heartbeat);
  await deps.nativeCluster.cleanup(env);
  await requireExecutionLease(heartbeat);
  const n = env.native!, now = deps.clock.now();
  await scope.environments.update({ ...env, state: n.failureReason ? 'failed' : 'released', connected: false, updatedAt: now,
    native: { ...n, state: 'finished' }, message: n.failureReason ?? 'CLI 执行环境已回收，工作树保持' });
  if (occupiesQuota(env.state)) await scope.admissions.release(env.projectId);
}

/** 父会话先等待所有引用结束，再删除其 Pod／工作卷；失败由同一持久作业接续。 */
export async function cleanupWorkspace(deps: NativeExecutionDeps, scope: RepositoryScope, env: TaskEnvironment, heartbeat: ExecutionLease): Promise<void> {
  const active = (await scope.environments.listChildren(env.id)).filter((child) => child.native?.state !== 'finished');
  if (active.length) {
    for (const child of active) await scope.nativeQueue.enqueue(child.id);
    throw new Error('等待 CLI 执行环境回收后释放工作区');
  }
  await requireExecutionLease(heartbeat);
  await deps.cluster.deletePod(env);
  if ((await deps.cluster.podPhase(env)).phase !== 'Missing') throw new Error('等待工作区容器退出');
  if (env.volumeMode === 'follow-container') await deps.cluster.deleteVolume(env);
  await requireExecutionLease(heartbeat);
  const now = deps.clock.now(), reason = env.release!.reason;
  await scope.environments.update(transition(env, 'released', now, { release: undefined, message: `released: ${reason}` }));
  if (env.release!.occupied) await scope.admissions.release(env.projectId);
  await scope.events.publish(DomainTopic.taskReleased, { occurredAt: now.toISOString(), traceId: env.traceId, projectId: env.projectId, taskId: env.id, kind: env.kind, reason });
}

export async function runNativeExecution(deps: NativeExecutionDeps, taskId: TaskId, heartbeat: ExecutionLease): Promise<void> {
  const original = await deps.uow.read.environments.getById(taskId);
  if (!original) return;
  await deps.uow.run(async (scope) => {
    await scope.admissions.lock(original.projectId);
    await requireExecutionLease(heartbeat);
    const env = await scope.environments.getById(taskId);
    if (env?.native?.state === 'queued') await prepareNativeExecution(deps, scope, env, heartbeat);
    else if (env?.native?.state === 'cleaning') await cleanupNativeExecution(deps, scope, env, heartbeat);
    else if (env?.release && env.state === 'releasing') await cleanupWorkspace(deps, scope, env, heartbeat);
  });
}

export async function describeNativeScheduling(deps: TaskRuntimeUseCaseDeps, env: TaskEnvironment, message: string): Promise<void> {
  await deps.uow.run(async (scope) => {
    await scope.admissions.lock(env.projectId);
    const current = await scope.environments.getById(env.id);
    if (current?.native?.state === 'starting' && current.podName === env.podName && current.message !== message) {
      await scope.environments.update({ ...current, message, updatedAt: deps.clock.now() });
    }
  });
}
