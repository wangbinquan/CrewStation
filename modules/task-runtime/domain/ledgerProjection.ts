import type { ClusterPurpose, ResourceConditionStatus, ResourceKind, StartupRecord } from '@crewstation/contracts';
import type { ExecutionPurpose, TaskEnvironment } from './taskEnvironment';
import { purposeOf } from './taskEnvironment';

/**
 * 任务环境投影到资源台账（RFC-025 第二期）：每个环境一条工作负载记录（开发工作区、业务任务工作区、Agent 执行），
 * 有自己工作卷的再加一条工作卷记录。期望与领域条件由这里算出，阶段由资源中心按观测与条件算，不在这里写。
 */
export interface ProjectedCondition {
  readonly type: string;
  readonly status: ResourceConditionStatus;
  readonly reason?: string;
  readonly message?: string;
}

export interface ProjectedRecord {
  /** 工作负载记录沿用环境 ID；工作卷记录由台账生成。 */
  readonly id?: string;
  readonly kind: ResourceKind;
  readonly ref: string;
  readonly projectId: TaskEnvironment['projectId'];
  /** 上级记录的 ID：工作负载记录沿用环境 ID，所以 Agent 执行的上级就是父工作区的环境 ID。 */
  readonly parentId?: string;
  readonly purpose?: ClusterPurpose;
  readonly children: readonly { readonly kind: string; readonly namespace: string; readonly name: string }[];
  readonly display: Readonly<Record<string, string>>;
  readonly conditions: readonly ProjectedCondition[];
  readonly startup?: StartupRecord;
  /** 期望「不要了」及其原因；没有就是「要」。 */
  readonly release?: { readonly code: string; readonly message: string };
}

export interface EnvironmentProjection {
  readonly workload: ProjectedRecord;
  readonly volume?: ProjectedRecord;
  /** Runner 当前是否连着；是否上报「断开」要看台账里是否曾经连上（资源中心按「曾经为真」判降级）。 */
  readonly connected: boolean;
}

const EXECUTION_PURPOSE: Record<ExecutionPurpose, ClusterPurpose> = { cli: 'development-cli', agent: 'development-agent', subtask: 'business-subtask' };
const RELEASE_MESSAGE: Record<string, string> = {
  user: '用户释放', 'owner-force': '负责人强制释放', business: '业务释放', failed: '失败后释放', 'pod-lost': '容器丢失后释放', 'profile-test': '档位测试结束',
};
const MAX_MESSAGE = 2000;
const clip = (text: string) => (text.length > MAX_MESSAGE ? `${text.slice(0, MAX_MESSAGE - 1)}…` : text);

function workloadKind(env: TaskEnvironment): ResourceKind {
  if (env.native || env.kind === 'profile-test') return 'agent-execution';
  return env.kind === 'dev-session' ? 'dev-workspace' : 'business-workspace';
}

function workloadPurpose(env: TaskEnvironment): ClusterPurpose {
  if (env.native) return EXECUTION_PURPOSE[purposeOf(env.native)];
  if (env.kind === 'profile-test') return 'profile-test';
  return env.kind === 'dev-session' ? 'development-workspace' : 'business-workspace';
}

/**
 * 已受理结束：环境在释放或已释放；Agent 执行进入清理或已结束。工作区直接释放时，受理那一步还不知道原因
 * （释放完才把 `released: <原因>` 写进 message），先报泛泛的 released，台账在拿到具体原因时补上。
 */
function releaseOf(env: TaskEnvironment): ProjectedRecord['release'] {
  const executionEnded = env.native?.state === 'cleaning' || env.native?.state === 'finished';
  if (env.state !== 'releasing' && env.state !== 'released' && !executionEnded) return undefined;
  if (env.native) return { code: env.release?.reason ?? 'execution-ended', message: clip(env.native.failureReason ?? env.message ?? '执行环境已结束') };
  const code = env.release?.reason ?? /^released: ([a-z-]+)$/.exec(env.message ?? '')?.[1] ?? 'released';
  return { code, message: RELEASE_MESSAGE[code] ?? '已释放' };
}

function failureCode(env: TaskEnvironment): string {
  const failed = env.startup?.stages.find((stage) => stage.state === 'failed');
  return failed?.error?.code ?? 'failed';
}

function conditionsOf(env: TaskEnvironment): ProjectedCondition[] {
  const failed = env.state === 'failed';
  const conditions: ProjectedCondition[] = [
    failed ? { type: 'Failed', status: 'true', reason: failureCode(env), message: clip(env.message ?? '平台判定失败') } : { type: 'Failed', status: 'false' },
    { type: 'Paused', status: env.state === 'paused' ? 'true' : 'false' },
    { type: 'Rebuilding', status: env.rebuildId && env.state === 'creating' ? 'true' : 'false' },
  ];
  if (env.native) conditions.push({ type: 'Prepared', status: env.native.state === 'queued' ? 'false' : 'true' });
  return conditions;
}

function workloadDisplay(env: TaskEnvironment): Record<string, string> {
  if (env.native) return { profile: env.native.profile.name, agent: env.native.agentId, ...(env.native.terminalId ? { terminal: env.native.terminalId } : {}) };
  return { profile: env.profile, ...(env.branch ? { branch: env.branch } : {}) };
}

export function projectEnvironment(env: TaskEnvironment): EnvironmentProjection {
  const release = releaseOf(env);
  const workload: ProjectedRecord = {
    id: env.id, kind: workloadKind(env), ref: env.id, projectId: env.projectId,
    ...(env.native ? { parentId: env.native.parentTaskId } : {}),
    purpose: workloadPurpose(env), children: [{ kind: 'Pod', namespace: env.namespace, name: env.podName }],
    display: workloadDisplay(env), conditions: conditionsOf(env), ...(env.startup ? { startup: env.startup } : {}), ...(release ? { release } : {}),
  };
  // Agent 执行挂父工作区的卷；档位测试用一次性的空目录。只有工作区自己有工作卷。
  const ownsVolume = !env.native && env.kind !== 'profile-test';
  const volumeReleased = release && env.volumeMode === 'follow-container' ? release : undefined;
  const volume: ProjectedRecord | undefined = ownsVolume ? {
    kind: 'volume', ref: `${env.id}/work`, projectId: env.projectId, parentId: env.id,
    children: [{ kind: 'PersistentVolumeClaim', namespace: env.namespace, name: env.pvcName }],
    display: { mode: env.volumeMode }, conditions: [], ...(volumeReleased ? { release: volumeReleased } : {}),
  } : undefined;
  return { workload, ...(volume ? { volume } : {}), connected: env.connected };
}

/**
 * Runner 连接条件：连着报「连上」；没连着时，台账里曾经连上过才报「断开」（资源中心按「曾经为真、现在为假」判降级），
 * 从没连上过就不报——那是还在启动。
 */
export function runnerCondition(connected: boolean, recorded: readonly { readonly type: string; readonly status: string }[]): ProjectedCondition[] {
  if (connected) return [{ type: 'RunnerConnected', status: 'true' }];
  const previous = recorded.find((condition) => condition.type === 'RunnerConnected');
  return previous && previous.status !== 'false' ? [{ type: 'RunnerConnected', status: 'false', message: 'Runner 已断开' }] : [];
}
