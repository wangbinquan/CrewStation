import type { NativeTerminalRecord, NativeTerminalSnapshotDto, ProfileRevisionRef, StartNativeTerminalRequest, StartupRecord, TaskId, UserId } from '@crewstation/contracts';

export interface NativeTerminalStart {
  taskId: TaskId;
  createdBy: UserId;
  clientRequestId: string;
  fingerprint: string;
  input: StartNativeTerminalRequest;
  /** RFC-006：受理时固定的档位修订；重试与后台派发只用它，不再看当前最新。RFC-006 之前受理的记录没有它，不能再派发。 */
  profile?: ProfileRevisionRef;
  record: NativeTerminalRecord;
  /** image：受理时档位修订按摘要固定的镜像（RFC-006）；之前受理的 CLI 没有，按平台任务镜像起。 */
  /** startup：RFC-022 的六段启动进度，就绪、失败或取消后冻结在这里，之后不再读事件。 */
  execution?: { previousTaskId?: TaskId; taskId: TaskId; taskProfile?: string; image?: string; stopRequested?: boolean; finalized?: boolean; screen?: 'available' | 'unavailable'; startup?: StartupRecord };
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
  /** 冻结启动进度（写进受理记录已有的 execution 文档，不加列）。 */
  saveStartup(taskId: TaskId, agentId: string, startup: StartupRecord): Promise<void>;
  getSnapshot(taskId: TaskId, agentId: string): Promise<NativeTerminalSnapshotDto>;
  finalize(taskId: TaskId, agentId: string): Promise<void>;
}
