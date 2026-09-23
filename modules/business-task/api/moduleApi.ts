import type { ClusterOperation, ClusterResource, ClusterInspectRequest, Actor, BusinessTaskDto, BusinessTaskState, CreateBusinessTaskRequest, DomainPayload, ProjectId, ServiceActor, SubmitSubtaskRequest, SubtaskDto, SubtaskId, SubtaskMessageRequest, TaskId } from '@crewstation/contracts';

/** 调用链回放用的业务任务：子任务含每次尝试，带创建时间、上一次尝试与执行环境。 */
export interface TraceBusinessTaskDto {
  id: TaskId; traceId: string; state: BusinessTaskState; callerIdentity: string; createdAt: string; updatedAt: string; closedAt?: string;
  subtasks: Array<SubtaskDto & { createdAt: string; retryOf?: SubtaskId; executionTaskId?: TaskId }>;
}

/** business-task 对外能力：业务服务以自身身份创建任务并提交契约化子任务；用户只读查看。 */
export interface BusinessTaskModuleApi {
  readonly name: 'business-task';
  inspectClusterTask(actor: Actor, target: ClusterResource, request: ClusterInspectRequest): Promise<Record<string, unknown>>;
  executeClusterTask(actor: Actor, operation: ClusterOperation): Promise<{ operationId: string }>;
  observeClusterTask(operation: ClusterOperation): Promise<{ done: boolean; failed?: boolean; reason: string }>;
  createTask(caller: ServiceActor, input: CreateBusinessTaskRequest): Promise<BusinessTaskDto>;
  getTask(caller: ServiceActor, taskId: TaskId): Promise<BusinessTaskDto>;
  closeTask(caller: ServiceActor, taskId: TaskId): Promise<BusinessTaskDto>;
  pauseTask(caller: ServiceActor, taskId: TaskId): Promise<BusinessTaskDto>;
  resumeTask(caller: ServiceActor, taskId: TaskId): Promise<BusinessTaskDto>;
  submitSubtask(caller: ServiceActor, taskId: TaskId, input: SubmitSubtaskRequest): Promise<SubtaskDto>;
  retrySubtask(caller: ServiceActor, taskId: TaskId, subtaskId: SubtaskId): Promise<SubtaskDto>;
  /** TaskRunner 连上时由组合根调用：派发等容器就绪的 pending 子任务，返回派发条数。 */
  dispatchPendingSubtasks(taskId: TaskId): Promise<number>;
  getSubtask(caller: ServiceActor, taskId: TaskId, subtaskId: SubtaskId): Promise<SubtaskDto>;
  listSubtasks(caller: ServiceActor, taskId: TaskId): Promise<SubtaskDto[]>;
  subtaskOutput(caller: ServiceActor, taskId: TaskId, subtaskId: SubtaskId): Promise<string>;
  sendSubtaskMessage(caller: ServiceActor, taskId: TaskId, subtaskId: SubtaskId, input: SubtaskMessageRequest): Promise<SubtaskDto>;
  cancelSubtask(caller: ServiceActor, taskId: TaskId, subtaskId: SubtaskId): Promise<SubtaskDto>;
  listProjectTasks(actor: Actor, projectId: ProjectId): Promise<BusinessTaskDto[]>;
  listProjectSubtasks(actor: Actor, projectId: ProjectId, taskId: TaskId): Promise<SubtaskDto[]>;
  /** 内部（无 actor）：追溯聚合使用。 */
  /** 调用链回放（Design §14）的内部读取，调用方已校验项目可见：这些 traceId 在本项目里的业务任务与子任务。 */
  listTraceTasks(projectId: ProjectId, traceIds: readonly string[]): Promise<TraceBusinessTaskDto[]>;
  registerContracts(payload: DomainPayload<'release.registered'>): Promise<void>;
  sweepActive(): Promise<number>;
}

export type { LegacyBusinessProjection } from './legacyBusiness';
