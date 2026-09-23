import type { Actor, AlertDto, HealthDto, LogEntryDto, LogQuery, ProjectId, TaskId, TraceChainDto, TraceEventDto, TraceEventsQuery, TraceId, TraceListQuery, TraceSummaryDto } from '@crewstation/contracts';

export interface ObservabilityModuleApi {
  readonly name: 'observability';
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
