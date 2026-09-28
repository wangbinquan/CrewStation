import type { ExecutionCompletionProof, RunnerBusinessEvent, RunnerBusinessReceipt, TaskId } from '@crewstation/contracts';

export interface StoredBusinessExecution {
  taskId: TaskId;
  receipt: RunnerBusinessReceipt;
  persistedThrough: number;
  acknowledgedThrough: number;
  /** 最终事件和此前每一个事件都已经落库；收到 finished 回执本身不够。 */
  complete: boolean;
}

export interface BusinessExecutionStore {
  completionProof(taskId: TaskId, executionId: string): Promise<ExecutionCompletionProof | undefined>;
  consume(taskId: TaskId, executionId: string, through: number, stopped?: boolean): Promise<void>;
  expire(): Promise<number>;
  register(taskId: TaskId, receipt: RunnerBusinessReceipt): Promise<StoredBusinessExecution>;
  ingest(taskId: TaskId, receipt: RunnerBusinessReceipt, events: RunnerBusinessEvent[]): Promise<StoredBusinessExecution>;
  get(taskId: TaskId, executionId: string): Promise<StoredBusinessExecution | undefined>;
  list(taskId: TaskId, executionId: string, after: number, limit: number): Promise<RunnerBusinessEvent[]>;
  acknowledge(taskId: TaskId, executionId: string, through: number): Promise<void>;
  pending(taskIds: TaskId[], limit: number): Promise<StoredBusinessExecution[]>;
}
