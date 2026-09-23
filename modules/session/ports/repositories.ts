import type { RunnerEvent, TaskId } from '@crewstation/contracts';

export interface StoredRunnerEvent {
  taskId: TaskId;
  seq: number;
  at: Date;
  event: RunnerEvent;
  legacyEvent?: unknown;
}

export interface RunnerEventStore {
  append(event: StoredRunnerEvent): Promise<void>;
  maxSeq(taskId: TaskId): Promise<number>;
  listSince(taskId: TaskId, sinceSeq: number, options: { kinds?: RunnerEvent['kind'][]; agentId?: string; limit: number }): Promise<StoredRunnerEvent[]>;
  /** 按任务汇总（调用链回放，Design §14）：指定种类的事件条数，以及出现过的原生会话 ID 与 Agent 协议。 */
  summarize(taskIds: readonly TaskId[], kinds: readonly RunnerEvent['kind'][]): Promise<RunnerEventSummary[]>;
}

export interface RunnerEventSummary { taskId: TaskId; events: number; sessionIds: string[]; protocol?: string }

/** 多副本：任务的 TaskRunner 连在哪个副本上；命令按此转发。 */
export interface ConnectionRegistry {
  claim(taskId: TaskId, replica: string, at: Date): Promise<void>;
  release(taskId: TaskId, replica: string): Promise<void>;
  heartbeat(taskId: TaskId, replica: string, at: Date): Promise<void>;
  lookup(taskId: TaskId): Promise<{ replica: string; lastSeenAt: Date } | undefined>;
}
