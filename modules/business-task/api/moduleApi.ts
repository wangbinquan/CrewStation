import type { Actor, BusinessTaskDto, CreateBusinessTaskRequest, DomainPayload, ProjectId, ServiceActor, SubmitSubtaskRequest, SubtaskDto, SubtaskId, SubtaskMessageRequest, TaskId } from '@crewstation/contracts';

/** business-task 对外能力：业务服务以自身身份创建任务并提交契约化子任务；用户只读查看。 */
export interface BusinessTaskModuleApi {
  readonly name: 'business-task';
  createTask(caller: ServiceActor, input: CreateBusinessTaskRequest): Promise<BusinessTaskDto>;
  getTask(caller: ServiceActor, taskId: TaskId): Promise<BusinessTaskDto>;
  closeTask(caller: ServiceActor, taskId: TaskId): Promise<BusinessTaskDto>;
  pauseTask(caller: ServiceActor, taskId: TaskId): Promise<BusinessTaskDto>;
  resumeTask(caller: ServiceActor, taskId: TaskId): Promise<BusinessTaskDto>;
  submitSubtask(caller: ServiceActor, taskId: TaskId, input: SubmitSubtaskRequest): Promise<SubtaskDto>;
  retrySubtask(caller: ServiceActor, taskId: TaskId, subtaskId: SubtaskId): Promise<SubtaskDto>;
  getSubtask(caller: ServiceActor, taskId: TaskId, subtaskId: SubtaskId): Promise<SubtaskDto>;
  listSubtasks(caller: ServiceActor, taskId: TaskId): Promise<SubtaskDto[]>;
  subtaskOutput(caller: ServiceActor, taskId: TaskId, subtaskId: SubtaskId): Promise<string>;
  sendSubtaskMessage(caller: ServiceActor, taskId: TaskId, subtaskId: SubtaskId, input: SubtaskMessageRequest): Promise<SubtaskDto>;
  cancelSubtask(caller: ServiceActor, taskId: TaskId, subtaskId: SubtaskId): Promise<SubtaskDto>;
  listProjectTasks(actor: Actor, projectId: ProjectId): Promise<BusinessTaskDto[]>;
  listProjectSubtasks(actor: Actor, projectId: ProjectId, taskId: TaskId): Promise<SubtaskDto[]>;
  /** 内部（无 actor）：追溯聚合使用。 */
  listProjectSubtasksInternal(taskId: TaskId): Promise<SubtaskDto[]>;
  registerContracts(payload: DomainPayload<'release.registered'>): Promise<void>;
  sweepActive(): Promise<number>;
}
