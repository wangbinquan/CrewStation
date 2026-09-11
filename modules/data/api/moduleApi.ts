import type { Actor, DataEnv, DataResourceDto, DecideTaskDataBinding, ProjectId, RequestTaskDataBinding, ServiceId, TaskDataBindingDto, TaskDataBindingState, TaskId } from '@crewstation/contracts';

/** data 模块对外能力：服务数据供给与环境变量渲染、开发会话的数据访问绑定。 */
export interface DataModuleApi {
  readonly name: 'data';
  ensureServiceData(serviceId: ServiceId): Promise<DataResourceDto[]>;
  envFor(serviceId: ServiceId, env: DataEnv): Promise<Record<string, string>>;
  listResources(actor: Actor, projectId: ProjectId): Promise<DataResourceDto[]>;
  requestTaskBinding(actor: Actor, ids: { taskId: TaskId; serviceId: ServiceId }, input: RequestTaskDataBinding): Promise<TaskDataBindingDto>;
  decideTaskBinding(actor: Actor, bindingId: string, input: DecideTaskDataBinding): Promise<TaskDataBindingDto>;
  revokeTaskBinding(actor: Actor, bindingId: string): Promise<TaskDataBindingDto>;
  listTaskBindings(actor: Actor, taskId: TaskId): Promise<TaskDataBindingDto[]>;
  listProjectBindings(actor: Actor, projectId: ProjectId, states?: TaskDataBindingState[]): Promise<TaskDataBindingDto[]>;
  envForTask(taskId: TaskId): Promise<Record<string, string>>;
  expireBindings(): Promise<number>;
}
