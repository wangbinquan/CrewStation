import type { RunnerEvent, TaskId } from '@crewstation/contracts';

export interface StoredRunnerEvent {
  taskId: TaskId;
  seq: number;
  at: Date;
  event: RunnerEvent;
}

export interface RunnerEventStore {
  append(event: StoredRunnerEvent): Promise<void>;
  maxSeq(taskId: TaskId): Promise<number>;
  listSince(taskId: TaskId, sinceSeq: number, options: { kinds?: RunnerEvent['kind'][]; agentId?: string; limit: number }): Promise<StoredRunnerEvent[]>;
}

/** 多副本：任务的 TaskRunner 连在哪个副本上；命令按此转发。 */
export interface ConnectionRegistry {
  claim(taskId: TaskId, replica: string, at: Date): Promise<void>;
  release(taskId: TaskId, replica: string): Promise<void>;
  heartbeat(taskId: TaskId, replica: string, at: Date): Promise<void>;
  lookup(taskId: TaskId): Promise<{ replica: string; lastSeenAt: Date } | undefined>;
}
