import { DevelopmentUsageStorageSchema, DevelopmentRemovalProtectionSchema, DevelopmentAdmissionStateSchema, WorkloadConsumerSchema, ResourceIdSchema } from '@crewstation/contracts';
import { conflict, isPlatformError, jsonHash, precondition } from '@crewstation/kernel';
import type { CreateNativeExecutionInput } from '../../api/moduleApi';
import { developmentWorkloadProtection } from '../../domain/development/protection';
import { completeStage } from '../../domain/podStartup';
import { canonicalNativeIntent } from '../../domain/physicalIdentity';
import { hashRunnerToken, newRunnerToken } from '../../domain/runnerToken';
import type { TaskEnvironment } from '../../domain/taskEnvironment';
import { reconcilerCreates } from '../../domain/taskEnvironment';
import type { NativeExecutionCluster } from '../../ports/cluster';
import type { NativeExecutionJobLease } from '../../ports/unitOfWork';
import type { TaskRuntimeUseCaseDeps } from '../dependencies';
import { containerEnv } from '../containerEnv';

type Deps = TaskRuntimeUseCaseDeps & { readonly nativeCluster: NativeExecutionCluster };
type Workspace = { readonly podUid: string; readonly pvcUid: string; readonly nodeName: string };
type Profile = { readonly id: string; readonly name: string; readonly cpu: string; readonly memory: string; readonly storage: string };
type Builder = (parent: TaskEnvironment, workspace: Workspace, profile: Profile) => TaskEnvironment;

/** Only submitted selectors participate: later settings never change an admitted request's identity. */
export function developmentRequestHash(input: CreateNativeExecutionInput): string {
  return jsonHash({ id: input.id, parentTaskId: input.parentTaskId, purpose: input.purpose ?? 'cli', createdBy: input.createdBy ?? null,
    agentId: input.agentId, terminalId: input.terminalId ?? null, runnerId: input.runnerId, fingerprint: input.fingerprint, profile: input.profile ?? null,
    image: input.image ?? null, computeProfile: input.computeProfile ?? null, runtimeImage: input.runtimeImage ?? null, businessSession: input.businessSession ?? null,
    developmentUsageStorage: input.developmentUsageStorage ?? null, developmentUsageProtection: input.developmentUsageProtection ?? null,
    ...(input.developmentRemovalProtection !== undefined ? { developmentRemovalProtection: input.developmentRemovalProtection } : {}) });
}
export function assertDevelopmentAdmission(deps: Deps, input: CreateNativeExecutionInput): void {
  if (input.developmentRemovalProtection !== undefined && (!DevelopmentRemovalProtectionSchema.safeParse(input.developmentRemovalProtection).success || !deps.workloadSafety?.get)) throw precondition('原开发准入回执选择或读取能力无效');
  if (!DevelopmentUsageStorageSchema.safeParse(input.developmentUsageProtection).success || !DevelopmentUsageStorageSchema.safeParse(input.developmentUsageStorage).success
    || input.purpose !== 'agent' || input.terminalId !== undefined || input.businessSession !== undefined || !ResourceIdSchema.safeParse(input.agentId).success
    || input.profile !== undefined && !ResourceIdSchema.safeParse(input.profile).success || !ResourceIdSchema.safeParse(input.computeProfile?.profileId).success
    || !Number.isSafeInteger(input.computeProfile?.revision) || input.computeProfile!.revision <= 0) throw precondition('只有原档位修订的独立开发 Agent 可选择工作卷保护 v1');
  if (!deps.uow.read.ledger || !deps.workloadSafety?.register) throw precondition('开发 Agent 的资源台账和持久消费者注册能力不可用');
}
function requireParent(parent: TaskEnvironment | undefined): asserts parent is TaskEnvironment {
  if (!parent || parent.native || parent.kind !== 'dev-session' || parent.state !== 'running' || !parent.connected) throw precondition('原开发工作区已经断开或释放，此 Agent 未启动');
}
export function developmentParentWitness(parent: TaskEnvironment): string {
  return jsonHash({ id: parent.id, projectId: parent.projectId, serviceId: parent.serviceId, kind: parent.kind, state: parent.state, connected: parent.connected,
    podName: parent.podName, pvcName: parent.pvcName, podUid: parent.podUid ?? null, start: parent.render?.start ?? null, rebuildId: parent.rebuildId ?? null, runnerTokenHash: parent.runnerTokenHash });
}
function unchangedParent(current: TaskEnvironment | undefined, original: TaskEnvironment): asserts current is TaskEnvironment {
  requireParent(current);
  if (developmentParentWitness(current) !== developmentParentWitness(original)) throw precondition('原开发工作区的执行身份已变化，此 Agent 未启动');
}
export async function createDevelopmentWorkload(deps: Deps, input: CreateNativeExecutionInput, parent: TaskEnvironment, sameRequest: (env: TaskEnvironment) => boolean, build: Builder): Promise<TaskEnvironment> {
  const prior = await deps.uow.read.environments.getById(input.id);
  if (prior) { if (!sameRequest(prior)) throw conflict('该 Agent 执行标识已用于另一份启动配置'); return prior; }
  requireParent(parent);
  const profile = await deps.profiles.getTaskProfile(input.profile ?? deps.settings.defaultProfile);
  if (!profile) throw precondition('原资源套餐不存在，请联系管理员调整算力档位');
  const workspace = await deps.nativeCluster.inspectWorkspace(parent), limit = await deps.quotas.quotaLimit(parent.projectId) ?? 0;
  if (parent.podUid && parent.podUid !== workspace.podUid) throw precondition('原开发工作区 Pod 已变化');
  const env = build(parent, workspace, profile);
  developmentWorkloadProtection(env);
  return deps.uow.run(async (scope) => {
    await scope.admissions.lock(parent.projectId);
    const previous = await scope.environments.getById(input.id);
    if (previous) { if (!sameRequest(previous)) throw conflict('该 Agent 执行标识已用于另一份启动配置'); return previous; }
    if (await scope.admissions.blocked(input.id)) throw conflict('开发执行准入已取消', { code: 'admission_cancelled' });
    unchangedParent(await scope.environments.getById(parent.id), parent);
    await scope.quota.acquire(env, limit, '项目并发额度已满，本次 Agent 未启动，已有 Agent 与 CLI 保持运行');
    await scope.environments.insert(env);
    if (!reconcilerCreates(env)) await scope.nativeQueue.enqueue(env.id);
    return env;
  });
}
function requireIdentity(deps: Deps, lease: NativeExecutionJobLease | undefined): asserts lease is NativeExecutionJobLease {
  if (!lease || !Number.isSafeInteger(lease.jobId) || lease.jobId <= 0 || !Number.isSafeInteger(lease.fencingToken) || lease.fencingToken <= 0 || !deps.uow.read.nativeLease) throw precondition('开发执行需要真实持久作业租约', { code: 'execution_lease_required' });
}
async function verifyWorkspace(deps: Deps, parent: TaskEnvironment, env: TaskEnvironment): Promise<void> {
  const actual = await deps.nativeCluster.inspectWorkspace(parent), n = env.native!;
  if (actual.podUid !== n.parentPodUid || actual.pvcUid !== n.pvcUid || actual.nodeName !== n.nodeName) throw precondition('启动期间原开发工作区实例或工作卷已变化');
}
async function heartbeat(renew: () => Promise<boolean>): Promise<void> {
  if (!await renew()) throw new Error('开发 Agent 执行作业租约已被接管');
}
async function requireOriginalReceiptSelection(deps: Deps, env: TaskEnvironment): Promise<boolean> {
  if (env.render?.developmentRemovalProtection === undefined) return true;
  const protection = developmentWorkloadProtection(env);
  if (!protection || !deps.workloadSafety?.register) throw precondition('原开发消费者注册能力未装配');
  const consumer = WorkloadConsumerSchema.parse({ ...protection.consumer, resourceId: env.id, namespace: env.namespace, podName: env.podName, volumeUid: protection.expectedVolumeUid });
  const state = await deps.workloadSafety.register(consumer), selected = DevelopmentAdmissionStateSchema.safeParse(state.developmentAdmission);
  if (state.admissionClosed) throw precondition('原开发消费者准入已关闭');
  if (state.developmentAdmission === undefined) return false;
  if (!selected.success || selected.data.intentHash !== canonicalNativeIntent(env.id, env.native!)) throw precondition('原开发准入回执选择与原意图不匹配');
  return true;
}
/** No project transaction is held during registration, cluster reads/writes, material or heartbeat. */
export async function prepareDevelopmentWorkload(deps: Deps, env: TaskEnvironment, renew: () => Promise<boolean>, identity: NativeExecutionJobLease | undefined): Promise<void> {
  requireIdentity(deps, identity);
  developmentWorkloadProtection(env);
  const parent = await deps.uow.read.environments.getById(env.native!.parentTaskId);
  requireParent(parent);
  await heartbeat(renew); await verifyWorkspace(deps, parent, env);
  if (!await requireOriginalReceiptSelection(deps, env)) return;
  const svc = await deps.services.resolveServiceById(env.serviceId);
  if (!svc) throw precondition('此 Agent 所属服务已不存在');
  let prepared: Awaited<ReturnType<NativeExecutionCluster['prepare']>>;
  try { prepared = await deps.nativeCluster.prepare(env, () => containerEnv(deps, env, svc, newRunnerToken())); }
  catch (error) {
    if (isPlatformError(error) && error.details['code'] === 'development_workload_pending') return;
    throw error;
  }
  await verifyWorkspace(deps, parent, env); await heartbeat(renew);
  await deps.uow.run(async (scope) => {
    await scope.admissions.lock(env.projectId);
    if (!scope.nativeLease) throw precondition('开发执行作业事务保护不可用');
    await scope.nativeLease.requireCurrent(identity, env.id);
    const latest = await scope.environments.getById(env.id);
    if (!latest?.native || latest.native.state !== 'queued' || latest.state !== 'creating' || jsonHash(latest) !== jsonHash(env)) throw precondition('开发 Agent 已变化，旧准备结果不再提交');
    unchangedParent(await scope.environments.getById(parent.id), parent);
    const at = deps.clock.now();
    await scope.environments.update({ ...latest, runnerTokenHash: hashRunnerToken(prepared.token), updatedAt: at,
      native: { ...latest.native, state: 'starting', podUid: prepared.podUid, secretUid: prepared.secretUid, preparedAt: at.toISOString() },
      message: '此 Agent 的执行容器已创建，等待调度和连接', ...(latest.startup ? { startup: completeStage(latest.startup, 'queue', at.toISOString()) } : {}) });
    await scope.nativeLease.requireCurrent(identity, env.id);
  });
}
