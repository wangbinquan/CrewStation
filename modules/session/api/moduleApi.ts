import type { DevelopmentUsageDrainReason, DevelopmentUsageLookup, DevelopmentUsageKey, DevelopmentUsageLoss, DevelopmentUsagePage, DevelopmentUsageRegistration, StoredDevelopmentUsage, DevelopmentNativePageEvidence } from '@crewstation/contracts';
import type { ExecutionCompletionProof, RunnerUsageMeasurement, RunnerUsageSourceIdentity, RunnerUsageSourcePage, RunnerBusinessEvent, StoredBusinessExecutionDto, RunnerCommand, RunnerEvent, RunnerHello, TaskId } from '@crewstation/contracts';
import type { ProjectDeletionContext, ProjectDeletionOwner, ProjectDeletionSessionData } from '@crewstation/contracts';

export interface StoredEventDto { seq: number; at: string; event: RunnerEvent }

/** session 模块对外能力（本进程内）；跨进程调用走 internal HTTP，客户端在 packages/session-client。 */
export interface SessionModuleApi {
  readonly name: 'session';
  readonly deletionOwner?: ProjectDeletionOwner;
  closeProjectDeletionTransport?(context: ProjectDeletionContext, consumerId: string): Promise<boolean>;
  sendProjectDeletionCommand?(context: ProjectDeletionContext, consumerId: string, command: RunnerCommand): Promise<unknown>;
  applyProjectDeletionData?(context: ProjectDeletionContext, taskId: TaskId, operation: ProjectDeletionSessionData): Promise<unknown>;
  originalProjectDeletionTasks?(context: ProjectDeletionContext, after: TaskId | null): Promise<readonly TaskId[]>;
  lookupDevelopmentUsage(taskId: TaskId): Promise<DevelopmentUsageLookup>;
  registerDevelopmentUsage(registration: DevelopmentUsageRegistration): Promise<StoredDevelopmentUsage>;
  getDevelopmentUsage(taskId: TaskId, key: DevelopmentUsageKey): Promise<StoredDevelopmentUsage | undefined>;
  requestDevelopmentUsageDrain(taskId: TaskId, key: DevelopmentUsageKey, reason: DevelopmentUsageDrainReason): Promise<StoredDevelopmentUsage>;
  markDevelopmentUsageUnavailable(taskId: TaskId, loss: DevelopmentUsageLoss): Promise<StoredDevelopmentUsage>;
  nextDevelopmentUsageSource(): Promise<DevelopmentUsagePage | undefined>;
  readDevelopmentNativePage(key: DevelopmentUsageKey, passId: string, ordinal: string): Promise<DevelopmentNativePageEvidence>;
  readDevelopmentUsageMeasurement(key: DevelopmentUsageKey, recordId: string, revision: number): Promise<RunnerUsageMeasurement | undefined>;
  acknowledgeDevelopmentUsageSource(key: DevelopmentUsageKey, through: number): Promise<void>;
  nextBusinessUsageSource(): Promise<RunnerUsageSourcePage | undefined>;
  readBusinessUsageMeasurement(source: RunnerUsageSourceIdentity, recordId: string, revision: number): Promise<RunnerUsageMeasurement | undefined>;
  acknowledgeBusinessUsageSource(taskId: TaskId, executionId: string, through: number): Promise<void>;
  getExecutionCompletionProof(taskId: TaskId, executionId: string): Promise<ExecutionCompletionProof | undefined>;
  consumeBusinessExecution(taskId: TaskId, executionId: string, through: number, stopped?: boolean): Promise<void>;
  getBusinessExecution(taskId: TaskId, executionId: string): Promise<StoredBusinessExecutionDto | undefined>;
  listBusinessExecutionEvents(taskId: TaskId, executionId: string, after: number, limit: number): Promise<RunnerBusinessEvent[]>;
  sendCommand(taskId: TaskId, command: RunnerCommand): Promise<unknown>;
  listEvents(taskId: TaskId, options: { sinceSeq?: number; kinds?: RunnerEvent['kind'][]; agentId?: string; limit?: number }): Promise<StoredEventDto[]>;
  /** 按任务汇总事件（调用链回放，Design §14）：指定种类的条数，以及出现过的原生会话 ID 与 Agent 协议；没有事件的任务不返回。 */
  summarizeEvents(taskIds: readonly TaskId[], kinds: RunnerEvent['kind'][]): Promise<Array<{ taskId: TaskId; events: number; sessionIds: string[]; protocol?: string }>>;
  connectionStatus(taskId: TaskId): Promise<{ connected: boolean; replica?: string; lastSeq?: number; protocols?: string[]; capabilities?: RunnerHello['capabilities'] }>;
}
