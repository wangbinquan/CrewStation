import type { BusinessTaskState, ProjectId, ServiceId, TaskId, TraceId, VolumeMode } from '@crewstation/contracts';
import { precondition } from '@crewstation/kernel';

/** 业务服务以自身身份创建的任务：一个长驻容器，其中并发运行契约化子任务（R30）。 */
export interface BusinessTask {
  readonly id: TaskId;
  readonly serviceId: ServiceId;
  readonly projectId: ProjectId;
  readonly callerIdentity: string;
  readonly state: BusinessTaskState;
  readonly traceId: TraceId;
  readonly volumeMode: VolumeMode;
  readonly profile: string;
  readonly labels: Record<string, string>;
  readonly message?: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly closedAt?: Date;
}

const NEXT: Record<BusinessTaskState, readonly BusinessTaskState[]> = {
  creating: ['running', 'failed', 'closing'],
  running: ['paused', 'closing', 'failed'],
  paused: ['creating', 'closing'],
  closing: ['closed', 'failed'],
  closed: [],
  failed: ['closing'],
};

export function transition(task: BusinessTask, state: BusinessTaskState, now: Date, patch: Partial<BusinessTask> = {}): BusinessTask {
  if (!NEXT[task.state].includes(state)) throw precondition(`业务任务 ${task.id} 不能从 ${task.state} 进入 ${state}`);
  return { ...task, ...patch, state, updatedAt: now };
}

export function acceptsSubtasks(task: BusinessTask): boolean {
  return task.state === 'creating' || task.state === 'running';
}
