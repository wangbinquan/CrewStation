import type {
  Actor, AlertDto, HealthDto, LogEntryDto, LogQuery, ObservationAgentPage, ObservationModelPage, ObservationOverview, ObservationPlatformPage,
  ObservationPlatformQuery, ObservationPrice, ObservationPriceHistory, ObservationPricingDirectory, ObservationProjectPage, ObservationTaskDetail,
  ObservationTaskPage, ObservationTaskPageQuery, ObservationWindowQuery, OperationalTelemetry, OperationalTelemetryQuery, ProjectCostVisibility,
  ProjectDeletionOwner, ProjectId, SaveObservationPriceInput, SetProjectCostVisibility, TaskId, TraceChainDto, TraceEventDto, TraceEventsQuery, TraceId,
  TraceListQuery, TraceSummaryDto,
} from '@crewstation/contracts';
import type { AgentCallRecorder } from './agentCalls';

export type { AgentCallOutcome, AgentCallRecorder, AgentCallStart, AgentCallTarget } from './agentCalls';

/** RFC-034 v2 §5：项目（projectId）与系统（null）两级共用的运行统计；价格与费用可见性仅系统。 */
export interface RuntimeStatisticsApi {
  overview(actor: Actor, projectId: ProjectId | null, query: ObservationWindowQuery): Promise<ObservationOverview>;
  tasks(actor: Actor, projectId: ProjectId | null, query: ObservationTaskPageQuery): Promise<ObservationTaskPage>;
  task(actor: Actor, projectId: ProjectId | null, taskId: string): Promise<ObservationTaskDetail>;
  agents(actor: Actor, projectId: ProjectId | null, query: ObservationWindowQuery): Promise<ObservationAgentPage>;
  models(actor: Actor, projectId: ProjectId | null, query: ObservationWindowQuery): Promise<ObservationModelPage>;
  projects(actor: Actor, query: ObservationWindowQuery): Promise<ObservationProjectPage>;
  platform(actor: Actor, query: ObservationPlatformQuery): Promise<ObservationPlatformPage>;
  pricing(actor: Actor): Promise<ObservationPricingDirectory>;
  priceHistory(actor: Actor, profileId: string, model: string): Promise<ObservationPriceHistory>;
  savePrice(actor: Actor, profileId: string, input: SaveObservationPriceInput): Promise<ObservationPrice>;
  costVisibility(actor: Actor, projectId: ProjectId): Promise<ProjectCostVisibility>;
  setCostVisibility(actor: Actor, projectId: ProjectId, input: SetProjectCostVisibility): Promise<ProjectCostVisibility>;
}

export interface ObservabilityModuleApi extends RuntimeStatisticsApi {
  readonly name: 'observability';
  /**
   * RFC-034 v2 §4：Agent 执行记录的写入口。owner（business-task / dev-session / task-runtime）在派发前受理、
   * 在 owner 判定的结束时补写终态；session 把 Runner 上报的快照与终态转交。组合根装配到各自声明的端口。
   */
  readonly agentCalls: AgentCallRecorder;
  readonly deletionOwner?: ProjectDeletionOwner;
  operationalTelemetry(actor: Actor, projectId: ProjectId | null, query: OperationalTelemetryQuery): Promise<OperationalTelemetry>;
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
