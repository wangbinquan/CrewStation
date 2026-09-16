import type { NativeTerminalRecord, NativeTerminalSnapshotDto, RuntimeRevisionRef, StartNativeTerminalRequest, TaskId, UserId } from '@crewstation/contracts';

export interface NativeTerminalStart {
  taskId: TaskId;
  createdBy: UserId;
  clientRequestId: string;
  fingerprint: string;
  input: StartNativeTerminalRequest;
  driver: 'claude-code' | 'opencode';
  model: string;
  /** RFC-004：受理时固定的运行环境版本；重试与后台派发只用它，不再看当前最新。 */
  runtime?: RuntimeRevisionRef;
  record: NativeTerminalRecord;
  execution?: { taskId: TaskId; taskProfile?: string; stopRequested?: boolean; finalized?: boolean; screen?: 'available' | 'unavailable' };
}

/** 只保存启动身份与配置，不存 MCP／模型凭据；同一次请求的配置与 Runner 身份不可变。 */
export interface NativeTerminalRepository {
  withExecutionLock(executionTaskId: TaskId, operation: () => Promise<void>): Promise<void>;
  findRequest(taskId: TaskId, actorId: UserId, requestId: string): Promise<NativeTerminalStart | undefined>;
  findAgent(taskId: TaskId, agentId: string): Promise<NativeTerminalStart | undefined>;
  findExecution(executionTaskId: TaskId): Promise<NativeTerminalStart | undefined>;
  listExecutions(afterAgentId?: string, limit?: number): Promise<NativeTerminalStart[]>;
  reserve(input: NativeTerminalStart): Promise<NativeTerminalStart>;
  list(taskId: TaskId): Promise<NativeTerminalStart[]>;
  saveRecord(taskId: TaskId, record: NativeTerminalRecord): Promise<void>;
  requestStop(taskId: TaskId, agentId: string): Promise<void>;
  saveSnapshot(taskId: TaskId, agentId: string, result: NativeTerminalSnapshotDto): Promise<void>;
  getSnapshot(taskId: TaskId, agentId: string): Promise<NativeTerminalSnapshotDto>;
  finalize(taskId: TaskId, agentId: string): Promise<void>;
}
