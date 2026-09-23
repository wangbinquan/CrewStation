import type { ProjectId, RunnerEvent, TaskId } from '@crewstation/contracts';
import type { TraceBusinessTaskPart, TraceDeliveryPart, TraceEnvironmentPart, TraceEventSummary, TraceKey, TraceStoredEvent } from '../domain/traceParts';

/** 按开始时间倒序翻页：before 取上一页最后一条的 (firstAt, traceId)。 */
export interface TraceKeyPage { readonly before?: { readonly at: string; readonly traceId: string }; readonly limit: number }

/** 能按项目列出链的来源（任务环境、事件投递）：两者都只看本项目的记录。 */
export interface TraceKeySource {
  traceKeys(projectId: ProjectId, page: TraceKeyPage): Promise<TraceKey[]>;
  /** since（ISO 时间）之后有活动、或仍在进行的链。 */
  activeTraceIds(projectId: ProjectId, since: string): Promise<string[]>;
}

/**
 * 调用链的数据来源（Design §14）：由组合根接到 task-runtime、events、business-task 与 session。
 * 每个方法都按项目取数：一个事件投给多个订阅项目时共用 traceId，别的项目的记录一条也不能带出来。
 */
export interface TraceChainSources {
  readonly environments: TraceKeySource & { list(projectId: ProjectId, traceIds: readonly string[]): Promise<TraceEnvironmentPart[]> };
  readonly deliveries: TraceKeySource & { list(projectId: ProjectId, traceIds: readonly string[]): Promise<TraceDeliveryPart[]> };
  readonly businessTasks: { list(projectId: ProjectId, traceIds: readonly string[]): Promise<TraceBusinessTaskPart[]> };
  readonly sessions: {
    summarize(taskIds: readonly TaskId[], kinds: RunnerEvent['kind'][]): Promise<TraceEventSummary[]>;
    events(taskId: TaskId, page: { afterSeq: number; limit: number; kinds: RunnerEvent['kind'][] }): Promise<TraceStoredEvent[]>;
  };
}
