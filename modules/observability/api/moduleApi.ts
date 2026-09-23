import type { Actor, AlertDto, HealthDto, LogEntryDto, LogQuery, ProjectId, TraceId, TraceReplayDto } from '@crewstation/contracts';

export interface ObservabilityModuleApi {
  readonly name: 'observability';
  queryLogs(actor: Actor, projectId: ProjectId, query: LogQuery): Promise<LogEntryDto[]>;
  health(actor: Actor, projectId: ProjectId): Promise<HealthDto[]>;
  listAlerts(actor: Actor, projectId: ProjectId): Promise<AlertDto[]>;
  replayTrace(actor: Actor, projectId: ProjectId, traceId: TraceId): Promise<TraceReplayDto>;
  /** 巡检一个项目的两槽健康态并触发／恢复告警。 */
  sweepProject(projectId: ProjectId): Promise<number>;
}
