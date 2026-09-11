import type { Actor, AlertDto, AlertSubscriptionDto, HealthDto, LogEntryDto, LogQuery, ProjectId, TraceId, TraceReplayDto, UserId } from '@crewstation/contracts';

export interface ObservabilityModuleApi {
  readonly name: 'observability';
  queryLogs(actor: Actor, projectId: ProjectId, query: LogQuery): Promise<LogEntryDto[]>;
  health(actor: Actor, projectId: ProjectId): Promise<HealthDto[]>;
  listAlerts(actor: Actor, projectId: ProjectId): Promise<AlertDto[]>;
  listSubscriptions(actor: Actor, projectId: ProjectId): Promise<AlertSubscriptionDto[]>;
  subscribe(actor: Actor, projectId: ProjectId, input: { userId: UserId; channel: 'workbench' | 'webhook'; target?: string }): Promise<void>;
  unsubscribe(actor: Actor, projectId: ProjectId, userId: UserId): Promise<void>;
  replayTrace(actor: Actor, projectId: ProjectId, traceId: TraceId): Promise<TraceReplayDto>;
  /** 巡检一个项目的两槽健康态并触发／恢复告警。 */
  sweepProject(projectId: ProjectId): Promise<number>;
}
