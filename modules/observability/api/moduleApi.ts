import type { RuntimeExportQuery, RuntimeExport, ProjectRuntimeStatistics, RuntimeStatisticsQuery, RuntimeTaskObservation, SystemRuntimeStatistics } from '@crewstation/contracts';
import type { ExecutionCostVisibilityDto, ExecutionObservationPage, ExecutionObservationQuery, SetExecutionCostVisibility, ExecutionValuationObservation, ExecutionObservationIdentity, ExecutionUsageObservation } from '@crewstation/contracts';
import type { Actor, AlertDto, HealthDto, LogEntryDto, LogQuery, ProjectId, TaskId, TraceChainDto, TraceEventDto, TraceEventsQuery, TraceId, TraceListQuery, TraceSummaryDto } from '@crewstation/contracts';

import type { TokenPricingApi } from './tokenPricingApi';

/** Public input/output values are independent of persistence ports. Wiring checks their structural compatibility. */
export interface ExecutionPriceInput {
  identity: ExecutionObservationIdentity;
  profile: { id: string; revision: number; protocol: 'opencode' | 'claude-code' | 'terminal' } | null;
}
export interface AcceptedExecutionPrice extends ExecutionPriceInput { acceptedAt: string; priceBookRevision: number }
export interface UsageSourcePage {
  projectId: ProjectId; taskId: TaskId; sourceId: string; expectedCursor: string | null; nextCursor: string;
  events: Array<{ eventId: string; measurement: Omit<ExecutionUsageObservation, 'projection'> }>;
}
export interface ExecutionValuationRequest {
  measurement: Pick<ExecutionUsageObservation, 'identity' | 'sourceId' | 'recordId'>;
  usageRevision: number; requestKey: string; model: { provider: string; model: string; condition: string | null } | null;
}
export interface ExecutionObservationCaller { identity: string; token?: string }

export interface ObservabilityModuleApi extends TokenPricingApi {
  readonly name: 'observability';
  projectRuntimeExport(actor: Actor, projectId: ProjectId, query: RuntimeExportQuery): Promise<RuntimeExport>;
  systemRuntimeExport(actor: Actor, query: RuntimeExportQuery): Promise<RuntimeExport>;
  projectRuntimeStatistics(actor: Actor, projectId: ProjectId, query: RuntimeStatisticsQuery): Promise<ProjectRuntimeStatistics>;
  systemRuntimeStatistics(actor: Actor, query: RuntimeStatisticsQuery): Promise<SystemRuntimeStatistics>;
  projectRuntimeTask(actor: Actor, projectId: ProjectId, taskId: TaskId): Promise<RuntimeTaskObservation>;
  systemRuntimeTask(actor: Actor, taskId: TaskId): Promise<RuntimeTaskObservation>;
  reconcileExecutionUsage(): Promise<number>;
  /** Internal owner admission participant; call before starting this execution. */
  acceptExecutionPrice(input: ExecutionPriceInput): Promise<AcceptedExecutionPrice>;
  /** Internal durable source ingestion; never an HTTP write endpoint. */
  ingestExecutionUsage(input: UsageSourcePage): Promise<{ cursor: string | null; applied: number; duplicate: number }>;
  /** Separate durable valuation; references one committed usage projection revision. */
  valueExecutionUsage(input: ExecutionValuationRequest): Promise<ExecutionValuationObservation>;
  executionObservations(caller: ExecutionObservationCaller, taskId: TaskId, query: ExecutionObservationQuery): Promise<ExecutionObservationPage>;
  executionCostVisibility(actor: Actor, projectId: ProjectId): Promise<ExecutionCostVisibilityDto>;
  setExecutionCostVisibility(actor: Actor, projectId: ProjectId, input: SetExecutionCostVisibility): Promise<ExecutionCostVisibilityDto>;
  queryLogs(actor: Actor, projectId: ProjectId, query: LogQuery): Promise<LogEntryDto[]>;
  health(actor: Actor, projectId: ProjectId): Promise<HealthDto[]>;
  listAlerts(actor: Actor, projectId: ProjectId): Promise<AlertDto[]>;
  /** 本项目的调用链，按开始时间倒序（Design §14）；nextCursor 缺省表示没有更早的了。 */
  listTraces(actor: Actor, projectId: ProjectId, query: TraceListQuery): Promise<{ items: TraceSummaryDto[]; nextCursor?: string }>;
  /** 一条链在本项目里的分层回放；本项目没有这条链时 not_found。 */
  getTraceChain(actor: Actor, projectId: ProjectId, traceId: TraceId): Promise<TraceChainDto>;
  /** 链上一个 Agent 执行的事件，按序号分页；执行不属于这条链（或本项目）时 not_found。 */
  listTraceEvents(actor: Actor, projectId: ProjectId, traceId: TraceId, taskId: TaskId, query: TraceEventsQuery): Promise<{ items: TraceEventDto[]; nextCursor?: string }>;
  /** 巡检一个项目的两槽健康态并触发／恢复告警。 */
  sweepProject(projectId: ProjectId): Promise<number>;
}
