import type { ProjectId, ServiceId, StartupRecord, TaskId, TaskKind, TraceId, UserId, VolumeMode } from '@crewstation/contracts';
import { precondition } from '@crewstation/kernel';
import { cancelStartup, completeThrough, defaultFailureCode, failStartup } from './podStartup';
export interface LegacyTaskClusterIdentity {
  readonly taskId: string;
  readonly rebuildId?: string;
  readonly native?: NativeExecution;
}

export type EnvironmentState = 'creating' | 'running' | 'paused' | 'releasing' | 'released' | 'failed';

/** 执行环境的用途（RFC-006 §5.1）：「＋ CLI」、开发会话里的 headless Agent、业务 Agent 子任务。 */
export type ExecutionPurpose = 'cli' | 'agent' | 'subtask';

/**
 * 一个 Agent 的独立执行实例（每个 Agent 一个 Pod，C3）；工作卷与数据绑定仍由父任务拥有。
 * 持久列沿用 native；RFC-006 之前受理的记录没有 purpose，按 cli 处理。
 */
export interface NativeExecution {
  readonly purpose?: ExecutionPurpose;
  readonly parentTaskId: TaskId;
  readonly parentPodUid: string;
  readonly pvcUid: string;
  readonly nodeName: string;
  readonly agentId: string;
  /** 只有「＋ CLI」有终端。 */
  readonly terminalId?: string;
  readonly runnerId: string;
  readonly fingerprint: string;
  readonly requestedProfile: string | null;
  readonly profile: { id: string; name: string; cpu: string; memory: string; storage: string };
  /** 档位修订按摘要固定的镜像；RFC-006 之前受理的 CLI 是平台任务镜像。 */
  readonly image: string;
  /** 受理时固定的算力档位修订（RFC-006）。 */
  readonly computeProfile?: { readonly profileId: string; readonly revision: number };
  readonly state: 'queued' | 'starting' | 'running' | 'cleaning' | 'finished';
  readonly podUid?: string;
  readonly secretUid?: string;
  readonly failureReason?: string;
  readonly preparedAt?: string;
}

/**
 * 资源中心照它建出这个环境的容器（RFC-025 I25 裁定：期望里不放凭据）：Pod、Runner Secret、开发预览的 Service 与路由，工作卷另有一条记录。
 * 凭据（Runner 令牌、配置与数据的连接串）在调和器建 Runner Secret 时由 task-runtime 当场给出，不落库。受理时定下；
 * 每次（重新）启动是第几次（start）决定 Runner Secret 的名字，恢复换一个新的，旧的由孤儿回收删掉。之前受理的环境没有它，照旧由 task-runtime 自己建。
 */
export interface WorkloadRender {
  readonly image: string;
  readonly workerUid: number;
  readonly resources: { readonly cpu: string; readonly memory: string; readonly storage: string };
  readonly start: number;
  readonly checkout?: { readonly repoUrl: string; readonly branch: string; readonly credentialSecretName: string };
  readonly previewRoute?: { readonly host: string; readonly middlewares: readonly { readonly name: string; readonly namespace?: string }[] };
  /**
   * 执行环境（I25 第二步）：父工作区受理那一刻的 Pod 名（重建过的工作区 Pod 换了名）。节点与父 Pod、工作卷的 UID 取自 `native`，
   * 调和器建之前照它们核对父工作区还是受理时那一个。
   */
  readonly execution?: { readonly workspacePod: string };
}

export interface RunnerRejection {
  readonly code: 'protocol_mismatch';
  readonly runnerProtocol: number | null;
  readonly message: string;
  readonly at: string;
}

/** 一项任务一个长驻容器（R05、R29）；开发会话与业务任务共用这个对象，只是 kind 与卷模式不同。 */
export interface TaskEnvironment {
  readonly legacyCluster?: LegacyTaskClusterIdentity;
  readonly id: TaskId;
  readonly projectId: ProjectId;
  readonly serviceId: ServiceId;
  readonly kind: TaskKind;
  readonly state: EnvironmentState;
  readonly volumeMode: VolumeMode;
  readonly profile: string;
  readonly namespace: string;
  readonly podName: string;
  /** Exact current instance; names alone cannot authorize cluster operations. */
  readonly podUid?: string;
  readonly pvcName: string;
  readonly traceId: TraceId;
  /** 一次性令牌的 sha256；明文只进容器环境变量。 */
  readonly runnerTokenHash: string;
  readonly connected: boolean;
  readonly branch?: string;
  readonly preview?: { command: string[]; port: number; healthPath: string };
  readonly labels: Record<string, string>;
  readonly createdBy?: UserId;
  readonly message?: string;
  readonly rebuildId?: string;
  readonly native?: NativeExecution;
  readonly release?: { reason: 'user' | 'owner-force' | 'business' | 'failed' | 'pod-lost' | 'profile-test'; occupied: boolean };
  /** Runner 握手被拒的原因（RFC-006）：旧底座镜像里的 Runner 协议不一致。只记录，不改状态、不删 Pod，也不动工作卷。 */
  readonly runnerRejection?: RunnerRejection;
  /** RFC-022：最近一次启动（受理、重建或恢复）的阶段进度；升级前创建的环境没有。 */
  readonly startup?: StartupRecord;
  /** RFC-025 I25：由资源中心建出容器时的期望（不含凭据）；没有就是 task-runtime 自己建。 */
  readonly render?: WorkloadRender;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly lastActivityAt: Date;
}

const NEXT: Record<EnvironmentState, readonly EnvironmentState[]> = {
  creating: ['running', 'failed', 'releasing'],
  running: ['paused', 'releasing', 'failed'],
  paused: ['creating', 'releasing'],
  failed: ['releasing', 'creating'],
  releasing: ['released', 'failed'],
  released: [],
};

export function transition(env: TaskEnvironment, state: EnvironmentState, now: Date, patch: Partial<TaskEnvironment> = {}): TaskEnvironment {
  if (!NEXT[env.state].includes(state)) throw precondition(`任务 ${env.id} 不能从 ${env.state} 进入 ${state}`, { from: env.state, to: state });
  const next: TaskEnvironment = { ...env, ...patch, state, updatedAt: now };
  return next.startup ? { ...next, startup: settleStartup(env.state, next, now.toISOString()) } : next;
}

/**
 * RFC-022：状态迁移顺带收束启动进度——连上即就绪、失败即失败、释放或暂停即取消。
 * 调用方在补丁里已经写好的（带失败归类与日志尾部的）不再进行中，这里原样保留。
 */
function settleStartup(from: EnvironmentState, next: TaskEnvironment, at: string): NonNullable<TaskEnvironment['startup']> {
  const startup = next.startup!;
  if (next.state === 'running' && from === 'creating') return completeThrough(startup, 'connect', at);
  if (next.state === 'failed') return failStartup(startup, at, { code: defaultFailureCode(startup), message: next.message ?? '启动失败' });
  if (next.state === 'releasing' || next.state === 'released' || next.state === 'paused') return cancelStartup(startup, at);
  return startup;
}

/** 占用并发配额的状态：暂停与已释放不占（R43）。 */
export function occupiesQuota(state: EnvironmentState): boolean {
  return state === 'creating' || state === 'running' || state === 'releasing';
}

export function canPause(env: TaskEnvironment): boolean {
  return env.kind === 'business' && env.volumeMode === 'persistent' && env.state === 'running';
}

/** 建 Pod 的宽限：记录先于 Pod 提交，Pod 建出并记下实例（podUid）之前，读到「Pod 不存在」是还没建成。 */
export const POD_CREATE_GRACE_MS = 2 * 60_000;

/**
 * 还在建 Pod：环境刚创建、还没记下 Pod 实例。RFC-022 的启动观测每秒读一次 Pod，常扫到「记录已提交、Pod 还没建」这段空档，
 * 这时的 Missing 不算失败；超过宽限仍没有 Pod（建 Pod 的进程中途没了），照旧判容器不存在。执行环境与重建各自在建好 Pod 后才进入可判定状态。
 */
export function awaitingPodCreation(env: TaskEnvironment, now: Date, graceMs = POD_CREATE_GRACE_MS): boolean {
  return env.state === 'creating' && !env.native && !env.rebuildId && !env.podUid && !graceElapsed(env, now, graceMs);
}

/**
 * 建容器的宽限过了没有：从最近一次启动算——资源中心建出的环境恢复时同样要等调和器建 Pod（RFC-025 I25），受理时刻早已过了宽限。
 * 资源中心建的执行环境过了宽限仍在排队，照「准备反复失败」收尾。
 */
export function graceElapsed(env: TaskEnvironment, now: Date, graceMs = POD_CREATE_GRACE_MS): boolean {
  const since = env.startup ? Date.parse(env.startup.startedAt) : env.createdAt.getTime();
  return now.getTime() - since >= graceMs;
}

/**
 * Pod 的工作负载标签用网关的 Pod 身份索引与项目网络策略认的名字：业务任务是 `business-task`（TaskKind 是 `business`）。
 * 此前直接写 TaskKind，业务任务 Pod 既不在身份索引里、也拿不到任务出站策略（RFC-006 起业务 Agent 子任务的 Pod 要访问模型端点）。
 */
export const WORKLOAD_LABELS: Readonly<Record<TaskKind, string>> = { 'dev-session': 'dev-session', business: 'business-task', 'profile-test': 'profile-test' };

/**
 * 由资源中心建出的环境（RFC-025 I25）：有渲染期望、不在重建（重建与档位测试仍由 task-runtime 自己建）。执行环境要带父工作区的 Pod 名，
 * 没有的照旧由本模块建。
 */
export function reconcilerCreates(env: TaskEnvironment): env is TaskEnvironment & { readonly render: WorkloadRender } {
  return !!env.render && !env.rebuildId && (!env.native || !!env.render.execution);
}

/**
 * 这一次启动的 Runner Secret：工作区是 `<Pod 名>-runner-<第几次启动>`，恢复换新名，Pod 只认它；执行环境不会再启动，
 * 沿用 `<Pod 名>-runner`（清理与孤儿判定认这个名字）。
 */
export function runnerSecretOf(env: TaskEnvironment & { readonly render: WorkloadRender }): string {
  return env.native ? `${env.podName}-runner` : `${env.podName}-runner-${env.render.start}`;
}

/** 所属模块要资源中心建出容器（领域条件 Provisioning）：工作区在创建中、还没绑定 Pod 实例；执行环境还在排队（准备好之前）。 */
export function wantsProvisioning(env: TaskEnvironment): boolean {
  return reconcilerCreates(env) && env.state === 'creating' && (env.native ? env.native.state === 'queued' : !env.podUid);
}

export function podNameFor(taskId: TaskId): string {
  return `task-${taskId.replaceAll('-', '')}`;
}

export function pvcNameFor(taskId: TaskId): string {
  return `task-${taskId.replaceAll('-', '')}-work`;
}

export const purposeOf = (execution: NativeExecution): ExecutionPurpose => execution.purpose ?? 'cli';

/** 各用途给用户看的称呼：消息里说「此 CLI」「此 Agent」「此子任务」，不混用。 */
export const EXECUTION_NOUN: Record<ExecutionPurpose, string> = { cli: 'CLI', agent: 'Agent', subtask: '子任务' };
