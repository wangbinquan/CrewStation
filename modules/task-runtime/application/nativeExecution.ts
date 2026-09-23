import type { TaskId } from '@crewstation/contracts';
import { DomainTopic } from '@crewstation/contracts';
import { conflict, notFound, precondition } from '@crewstation/kernel';
import type { CreateNativeExecutionInput, ReleaseReason } from '../api/moduleApi';
import { cancelStartup, completeStage, failStartup, initialStartup } from '../domain/podStartup';
import { hashRunnerToken, newRunnerToken } from '../domain/runnerToken';
import type { ExecutionPurpose, NativeExecution, TaskEnvironment } from '../domain/taskEnvironment';
import { EXECUTION_NOUN, occupiesQuota, purposeOf, transition } from '../domain/taskEnvironment';
import type { NativeExecutionCluster } from '../ports/cluster';
import type { RepositoryScope } from '../ports/unitOfWork';
import type { TaskRuntimeUseCaseDeps } from './dependencies';
import { containerEnv } from './containerEnv';

export type NativeExecutionDeps = TaskRuntimeUseCaseDeps & { nativeCluster: NativeExecutionCluster };
export type ExecutionLease = () => Promise<boolean>;
export const requireExecutionLease = async (heartbeat: ExecutionLease) => { if (!await heartbeat()) throw new Error('CLI 执行作业租约已被接管'); };

function sameRequest(env: TaskEnvironment, input: CreateNativeExecutionInput): boolean {
  const n = env.native;
  return !!n && purposeOf(n) === (input.purpose ?? 'cli') && n.parentTaskId === input.parentTaskId && env.createdBy === input.createdBy && n.agentId === input.agentId
    && n.terminalId === input.terminalId && n.runnerId === input.runnerId && n.fingerprint === input.fingerprint && n.requestedProfile === (input.profile ?? null);
}

/** 各用途的父任务种类与被拒时给用户的话（RFC-006 §5.2）：额度满只影响这一个 Agent。 */
const ADMISSION: Record<ExecutionPurpose, { parentKind: TaskEnvironment['kind']; parentLabel: string; unavailable: string; quota: string; podPrefix: string }> = {
  cli: { parentKind: 'dev-session', parentLabel: '开发会话', unavailable: '工作区未连接或正在释放，不能新增 CLI', quota: '项目并发额度已满，本次 CLI 未启动，已有窗口保持运行', podPrefix: 'cli' },
  agent: { parentKind: 'dev-session', parentLabel: '开发会话', unavailable: '工作区未连接或正在释放，不能启动 Agent', quota: '项目并发额度已满，本次 Agent 未启动，已有 Agent 与 CLI 保持运行', podPrefix: 'agt' },
  subtask: { parentKind: 'business', parentLabel: '业务任务', unavailable: '业务任务容器未连接或正在释放，子任务未启动', quota: '项目并发额度已满，子任务未启动；请稍后重试', podPrefix: 'sub' },
};

/** 受理只登记意图。配额、不可变执行身份与队列在同一项目事务中提交。 */
export function createNativeExecutionUseCase(deps: NativeExecutionDeps) {
  return async (input: CreateNativeExecutionInput): Promise<TaskEnvironment> => {
    const purpose = input.purpose ?? 'cli', rule = ADMISSION[purpose];
    const original = await deps.uow.read.environments.getById(input.parentTaskId);
    if (!original) throw notFound(rule.parentLabel, input.parentTaskId);
    return deps.uow.run(async (scope) => {
      await scope.admissions.lock(original.projectId);
      const previous = await scope.environments.getById(input.id);
      if (previous) {
        if (!sameRequest(previous, input)) throw conflict(`该${EXECUTION_NOUN[purpose]}执行标识已用于另一份启动配置`);
        return previous;
      }
      const parent = await scope.environments.getById(input.parentTaskId);
      if (!parent || parent.native || parent.kind !== rule.parentKind || parent.state !== 'running' || !parent.connected) throw precondition(rule.unavailable);
      const profile = await deps.profiles.getTaskProfile(input.profile ?? deps.settings.defaultProfile);
      if (!profile) throw precondition(`算力档位指定的资源套餐 ${input.profile ?? deps.settings.defaultProfile} 不存在，请联系管理员调整算力档位`);
      const workspace = await deps.nativeCluster.inspectWorkspace(parent);
      const limit = (await deps.quotas.quotaLimit(parent.projectId)) ?? 0;
      const env = executionEnvironment(deps, input, parent, workspace, profile);
      await scope.quota.acquire(env, limit, rule.quota);
      await scope.environments.insert(env);
      await scope.nativeQueue.enqueue(env.id);
      return env;
    });
  };
}

type TaskProfileRecord = { id: string; name: string; cpu: string; memory: string; storage: string };

function executionEnvironment(deps: NativeExecutionDeps, input: CreateNativeExecutionInput, parent: TaskEnvironment, workspace: { podUid: string; pvcUid: string; nodeName: string }, profile: TaskProfileRecord): TaskEnvironment {
  const purpose = input.purpose ?? 'cli', now = deps.clock.now();
  const native: NativeExecution = { ...(purpose === 'cli' ? {} : { purpose }), parentTaskId: parent.id, parentPodUid: workspace.podUid, pvcUid: workspace.pvcUid, nodeName: workspace.nodeName,
    agentId: input.agentId, ...(input.terminalId ? { terminalId: input.terminalId } : {}), runnerId: input.runnerId, fingerprint: input.fingerprint, requestedProfile: input.profile ?? null,
    profile: { id: profile.id, name: profile.name, cpu: profile.cpu, memory: profile.memory, storage: profile.storage }, image: input.image ?? deps.settings.taskImage,
    ...(input.computeProfile ? { computeProfile: input.computeProfile } : {}), state: 'queued' };
  return { id: input.id, projectId: parent.projectId, serviceId: parent.serviceId, kind: parent.kind, state: 'creating',
    volumeMode: 'persistent', profile: profile.id, namespace: parent.namespace, podName: `${ADMISSION[purpose].podPrefix}-${input.id.replaceAll('-', '')}`, pvcName: parent.pvcName,
    traceId: parent.traceId, runnerTokenHash: hashRunnerToken(newRunnerToken()), connected: false, labels: parent.labels, ...(input.createdBy ? { createdBy: input.createdBy } : {}),
    native, message: `已受理，正在准备此${EXECUTION_NOUN[purpose]}的独立执行环境`, createdAt: now, updatedAt: now, lastActivityAt: now, startup: initialStartup(now) };
}

/** 准备执行环境反复失败时给用户的话：只说这一个 Agent，不牵连其他 Agent、窗口与工作树。 */
export function preparationFailureReason(env: TaskEnvironment): string {
  return `此${EXECUTION_NOUN[purposeOf(env.native!)]}的执行环境准备失败，其他 Agent、窗口与工作树保持`;
}

/**
 * 准备执行环境反复失败或前置条件不满足：记下失败原因并交给清理。前置条件不满足多半是原工作区断开或变化，
 * 其余是反复建不出执行容器（RFC-022 的失败归类）。
 */
export async function failPreparation(scope: RepositoryScope, env: TaskEnvironment, now: Date, reason: string, workspaceLost: boolean): Promise<TaskEnvironment> {
  const startup = env.startup ? failStartup(env.startup, now.toISOString(), { code: workspaceLost ? 'workspace-lost' : 'pod-create-failed', message: reason }) : undefined;
  return scheduleExecutionCleanup(scope, startup ? { ...env, startup } : env, now, reason);
}

/** 清理意图先持久化并失效凭据；卷、原开发容器和其他 CLI 不参与此状态迁移。 */
export async function scheduleExecutionCleanup(scope: RepositoryScope, env: TaskEnvironment, now: Date, failureReason?: string): Promise<TaskEnvironment> {
  if (!env.native || env.native.state === 'finished') return env;
  // 判定失败的调用方已把启动进度记为失败（带归类与日志）；其余（停止、暂停、管理员重启）在启动中即为取消。
  const next: TaskEnvironment = { ...env, state: 'releasing', native: { ...env.native, state: 'cleaning', ...(failureReason ? { failureReason } : {}) },
    ...(env.startup ? { startup: cancelStartup(env.startup, now.toISOString()) } : {}),
    runnerTokenHash: hashRunnerToken(newRunnerToken()), connected: false, message: failureReason ?? `此${EXECUTION_NOUN[purposeOf(env.native)]}已结束，正在回收执行环境`, updatedAt: now };
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
  if (!parent || parent.state !== 'running' || !parent.connected) throw precondition(`原工作区已经断开或释放，此${EXECUTION_NOUN[purposeOf(n)]}未启动`);
  const verifyWorkspace = async () => {
    const workspace = await deps.nativeCluster.inspectWorkspace(parent);
    if (workspace.podUid !== n.parentPodUid || workspace.pvcUid !== n.pvcUid || workspace.nodeName !== n.nodeName) throw precondition(`启动期间原工作区实例或工作卷已变化，此${EXECUTION_NOUN[purposeOf(n)]}未启动`);
  };
  await requireExecutionLease(heartbeat);
  await verifyWorkspace();
  const svc = await deps.services.resolveServiceById(env.serviceId);
  if (!svc) throw precondition(`此${EXECUTION_NOUN[purposeOf(n)]}所属服务已不存在`);
  const prepared = await deps.nativeCluster.prepare(env, () => containerEnv(deps, env, svc, newRunnerToken()));
  await verifyWorkspace();
  await requireExecutionLease(heartbeat);
  const now = deps.clock.now();
  await scope.environments.update({ ...env, runnerTokenHash: hashRunnerToken(prepared.token), updatedAt: now,
    native: { ...n, state: 'starting', podUid: prepared.podUid, secretUid: prepared.secretUid, preparedAt: now.toISOString() }, message: `此${EXECUTION_NOUN[purposeOf(n)]}的执行容器已创建，等待调度和连接`,
    ...(env.startup ? { startup: completeStage(env.startup, 'queue', now.toISOString()) } : {}) });
}

export async function cleanupNativeExecution(deps: NativeExecutionDeps, scope: RepositoryScope, env: TaskEnvironment, heartbeat: ExecutionLease): Promise<void> {
  await requireExecutionLease(heartbeat);
  await deps.nativeCluster.cleanup(env);
  await requireExecutionLease(heartbeat);
  const n = env.native!, now = deps.clock.now();
  await scope.environments.update({ ...env, state: n.failureReason ? 'failed' : 'released', connected: false, updatedAt: now,
    native: { ...n, state: 'finished' }, message: n.failureReason ?? `此${EXECUTION_NOUN[purposeOf(n)]}的执行环境已回收，工作树保持` });
  if (occupiesQuota(env.state)) await scope.quota.release(env);
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
  if (env.release!.occupied) await scope.quota.release(env);
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
