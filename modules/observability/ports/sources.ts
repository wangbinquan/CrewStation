import type { Actor, LogEntryDto, ProjectId, ResourceChild, ResourceCondition, ServiceId, RunnerEvent, TaskId } from "@crewstation/contracts";
import type { TraceBusinessTaskPart, TraceDeliveryPart, TraceEnvironmentPart, TraceEventSummary, TraceKey, TraceStoredEvent } from "../domain/traceAssembly";

export interface ProjectAuthorizer {
  authorize(actor: Actor, projectId: ProjectId, action: 'view'): Promise<unknown>;
}

export interface ServiceResolver {
  resolveServiceOfProject(projectId: ProjectId): Promise<{ serviceId: ServiceId; slug: string; name: string; namespace: string } | undefined>;
}

/** 由 release 提供：两个物理槽的角色，用于把 prod／preview 映射到 Deployment 名。 */
export interface SlotRoles {
  slotRoles(serviceId: ServiceId): Promise<{ prod: 'blue' | 'green'; preview: 'blue' | 'green' } | undefined>;
}

/** 服务槽记录里健康判定用得到的部分（RFC-025 第三期）：物理槽、子对象观测（Deployment 与它的 Pod）、条件、阶段起点。 */
export interface SlotRecordView {
  readonly physical: string;
  readonly children: readonly ResourceChild[];
  readonly conditions: readonly ResourceCondition[];
  readonly phaseSince: string;
}

/** 由组合根从资源中心提供：项目的服务槽记录（含已结束的）；读失败抛错，调用方退回按请求读集群。 */
export interface SlotRecords {
  slotRecords(projectId: ProjectId): Promise<readonly SlotRecordView[]>;
}

export interface WorkloadObservation {
  replicas: number;
  readyReplicas: number;
  restarts: number;
  lastRestartAgeSeconds?: number;
  lastTransitionAt: string;
}

/** 集群观测：Deployment 状态与 Pod 日志；实现在 adapters/k8s。 */
export interface ClusterObserver {
  observeDeployment(namespace: string, name: string): Promise<WorkloadObservation | undefined>;
  tailLogs(namespace: string, selector: string, options: { tailLines: number; sinceSeconds?: number }): Promise<LogEntryDto[]>;
}

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
