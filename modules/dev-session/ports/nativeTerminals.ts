import type { NativeTerminalRecord, StartNativeTerminalRequest, TaskId, UserId } from '@crewstation/contracts';

export interface NativeTerminalStart {
  taskId: TaskId;
  createdBy: UserId;
  clientRequestId: string;
  fingerprint: string;
  input: StartNativeTerminalRequest;
  driver: 'claude-code' | 'opencode';
  model: string;
  record: NativeTerminalRecord;
}

/** 只保存启动身份与配置，不存 MCP／模型凭据；同一次请求的配置与 Runner 身份不可变。 */
export interface NativeTerminalRepository {
  findRequest(taskId: TaskId, actorId: UserId, requestId: string): Promise<NativeTerminalStart | undefined>;
  reserve(input: NativeTerminalStart): Promise<NativeTerminalStart>;
  list(taskId: TaskId): Promise<NativeTerminalStart[]>;
  saveRecord(taskId: TaskId, record: NativeTerminalRecord): Promise<void>;
}
