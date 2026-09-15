import type { ProjectId, ServiceId, TaskId, TaskKind, TraceId, UserId, VolumeMode } from '@crewstation/contracts';
import { precondition } from '@crewstation/kernel';

export type EnvironmentState = 'creating' | 'running' | 'paused' | 'releasing' | 'released' | 'failed';

/** 一个原生 CLI 的独立执行实例；工作卷与数据绑定仍由父开发会话拥有。 */
export interface NativeExecution {
  readonly parentTaskId: TaskId;
  readonly parentPodUid: string;
  readonly pvcUid: string;
  readonly nodeName: string;
  readonly agentId: string;
  readonly terminalId: string;
  readonly runnerId: string;
  readonly fingerprint: string;
  readonly requestedProfile: string | null;
  readonly profile: { name: string; cpu: string; memory: string; storage: string };
  readonly image: string;
  readonly state: 'queued' | 'starting' | 'running' | 'cleaning' | 'finished';
  readonly podUid?: string;
  readonly secretUid?: string;
  readonly failureReason?: string;
  readonly preparedAt?: string;
}

/** 一项任务一个长驻容器（R05、R29）；开发会话与业务任务共用这个对象，只是 kind 与卷模式不同。 */
export interface TaskEnvironment {
  readonly id: TaskId;
  readonly projectId: ProjectId;
  readonly serviceId: ServiceId;
  readonly kind: TaskKind;
  readonly state: EnvironmentState;
  readonly volumeMode: VolumeMode;
  readonly profile: string;
  readonly namespace: string;
  readonly podName: string;
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
  readonly release?: { reason: 'user' | 'owner-force' | 'business' | 'failed' | 'pod-lost'; occupied: boolean };
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
  return `task-${taskId.slice(4, 16)}`;
}

export function pvcNameFor(taskId: TaskId): string {
  return `task-${taskId.slice(4, 16)}-work`;
}
