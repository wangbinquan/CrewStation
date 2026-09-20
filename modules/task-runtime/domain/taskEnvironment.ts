import type { ProjectId, ServiceId, TaskId, TaskKind, TraceId, UserId, VolumeMode } from '@crewstation/contracts';
import { precondition } from '@crewstation/kernel';
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
  return { ...env, ...patch, state, updatedAt: now };
}

/** 占用并发配额的状态：暂停与已释放不占（R43）。 */
export function occupiesQuota(state: EnvironmentState): boolean {
  return state === 'creating' || state === 'running' || state === 'releasing';
}

export function canPause(env: TaskEnvironment): boolean {
  return env.kind === 'business' && env.volumeMode === 'persistent' && env.state === 'running';
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
