import type { BusinessTaskState, DeliveryState, RunnerEvent, SubtaskId, SubtaskMode, SubtaskState, TaskId, TraceTaskState } from '@crewstation/contracts';

/** 调用链的原始部件（Design §14）：各模块按项目、按 traceId 交来的记录；组装与判定都在本目录的纯函数里。 */

/** 按 traceId 分组的时间键：firstAt 为毫秒精度的开始时间，active 表示这一部分还在进行。 */
export interface TraceKey { readonly traceId: string; readonly firstAt: string; readonly lastAt: string; readonly active: boolean }
/** 链上的任务环境：开发会话、业务任务，以及挂在它们下面的 Agent 执行（native）。 */
export interface TraceEnvironmentPart {
  readonly id: TaskId;
  readonly traceId: string;
  readonly kind: 'dev-session' | 'business' | 'profile-test';
  readonly state: TraceTaskState;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly lastActivityAt: string;
  readonly createdBy?: string;
  readonly branch?: string;
  readonly message?: string;
  readonly native?: {
    readonly purpose: 'cli' | 'agent' | 'subtask';
    readonly parentTaskId: TaskId;
    readonly agentId: string;
    readonly state: 'queued' | 'starting' | 'running' | 'cleaning' | 'finished';
    readonly profile: { readonly name: string };
    readonly failureReason?: string;
  };
}

export interface TraceDeliveryPart {
  readonly id: string;
  readonly eventId: string;
  readonly eventType: string;
  readonly traceId: string;
  readonly state: DeliveryState;
  readonly attempts: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly deliveredAt?: string;
  readonly nextAttemptAt?: string;
  readonly lastError?: string;
}

export interface TraceSubtaskPart {
  readonly id: SubtaskId;
  readonly taskId: TaskId;
  readonly name: string;
  readonly kind: 'agent' | 'command';
  readonly mode?: SubtaskMode;
  readonly state: SubtaskState;
  readonly attempt: number;
  readonly retryOf?: SubtaskId;
  readonly agentProfileName?: string;
  readonly sessionId?: string;
  readonly error?: string;
  readonly createdAt: string;
  readonly endedAt?: string;
  readonly executionTaskId?: TaskId;
}

export interface TraceBusinessTaskPart {
  readonly id: TaskId;
  readonly traceId: string;
  readonly state: BusinessTaskState;
  readonly callerIdentity: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly closedAt?: string;
  readonly subtasks: readonly TraceSubtaskPart[];
}

/** 一个执行环境的事件汇总：指定种类的条数、出现过的原生会话 ID 与 Agent 协议。 */
export interface TraceEventSummary { readonly taskId: TaskId; readonly events: number; readonly sessionIds: readonly string[]; readonly protocol?: string }
export interface TraceStoredEvent { readonly seq: number; readonly at: string; readonly event: RunnerEvent }
