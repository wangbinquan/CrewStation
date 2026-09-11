import type {
  BusinessTaskDto, DataResourceDto, DecideTaskDataBinding, ProjectId, SubtaskDto, TaskDataBindingDto, TaskDataBindingState, TaskId, TaskKind, VolumeMode,
} from '@crewstation/contracts';
import type { Transport } from '../httpTransport';
import type { ItemsPage } from '../itemsPage';
import type { RequestTaskDataBindingInput } from '../requestInputs';
import { segment } from '../requestUrl';

export type TaskEnvironmentState = 'creating' | 'running' | 'paused' | 'releasing' | 'released' | 'failed';

/**
 * 任务环境（TaskEnvironment）的只读视图：task-runtime 模块 `EnvironmentDto` 的镜像。
 * contracts 尚未收录该 DTO，这里按模块 api 手写；两处不一致时以模块为准并回填 contracts。
 */
export interface TaskEnvironmentDto {
  readonly id: TaskId;
  readonly projectId: ProjectId;
  readonly serviceId: string;
  readonly kind: TaskKind;
  readonly state: TaskEnvironmentState;
  readonly volumeMode: VolumeMode;
  readonly profile: string;
  readonly podName: string;
  /** TaskRunner 是否已连到 cs-session。 */
  readonly connected: boolean;
  readonly branch?: string;
  readonly preview?: { readonly command: string[]; readonly port: number; readonly healthPath: string };
  readonly traceId: string;
  readonly createdBy?: string;
  readonly message?: string;
  readonly createdAt: string;
  readonly lastActivityAt: string;
}

/** 任务：环境只读视图（task-runtime）、业务任务只读视图（business-task）、开发会话的数据访问绑定（data）。 */
export interface TasksResource {
  /** GET /v1/projects/:projectId/tasks?state= */
  list(projectId: string, query?: { readonly state?: TaskEnvironmentState }): Promise<ItemsPage<TaskEnvironmentDto>>;
  /** GET /v1/tasks/:taskId */
  describe(taskId: string): Promise<TaskEnvironmentDto>;
  /** GET /v1/projects/:projectId/business-tasks */
  listBusinessTasks(projectId: string): Promise<ItemsPage<BusinessTaskDto>>;
  /** GET /v1/projects/:projectId/business-tasks/:taskId/subtasks */
  listBusinessSubtasks(projectId: string, taskId: string): Promise<ItemsPage<SubtaskDto>>;
  /** GET /v1/projects/:projectId/data/resources */
  listDataResources(projectId: string): Promise<ItemsPage<DataResourceDto>>;
  /** POST /v1/services/:serviceId/tasks/:taskId/data-bindings（201）：申请数据访问模式；后两种需负责人批准。 */
  requestDataBinding(serviceId: string, taskId: string, input: RequestTaskDataBindingInput): Promise<TaskDataBindingDto>;
  /** GET /v1/tasks/:taskId/data-bindings */
  listTaskDataBindings(taskId: string): Promise<ItemsPage<TaskDataBindingDto>>;
  /** GET /v1/projects/:projectId/data-bindings?state= */
  listProjectDataBindings(projectId: string, query?: { readonly state?: TaskDataBindingState }): Promise<ItemsPage<TaskDataBindingDto>>;
  /** POST /v1/data-bindings/:id/decision（负责人） */
  decideDataBinding(bindingId: string, input: DecideTaskDataBinding): Promise<TaskDataBindingDto>;
  /** POST /v1/data-bindings/:id/revoke */
  revokeDataBinding(bindingId: string): Promise<TaskDataBindingDto>;
}

export function tasksResource(transport: Transport): TasksResource {
  const project = (projectId: string) => `/v1/projects/${segment(projectId)}`;
  const task = (taskId: string) => `/v1/tasks/${segment(taskId)}`;
  return {
    list: (projectId, query) => transport.request<ItemsPage<TaskEnvironmentDto>>('GET', `${project(projectId)}/tasks`, { query }),
    describe: (taskId) => transport.request<TaskEnvironmentDto>('GET', task(taskId)),
    listBusinessTasks: (projectId) => transport.request<ItemsPage<BusinessTaskDto>>('GET', `${project(projectId)}/business-tasks`),
    listBusinessSubtasks: (projectId, taskId) =>
      transport.request<ItemsPage<SubtaskDto>>('GET', `${project(projectId)}/business-tasks/${segment(taskId)}/subtasks`),
    listDataResources: (projectId) => transport.request<ItemsPage<DataResourceDto>>('GET', `${project(projectId)}/data/resources`),
    requestDataBinding: (serviceId, taskId, input) =>
      transport.request<TaskDataBindingDto>('POST', `/v1/services/${segment(serviceId)}/tasks/${segment(taskId)}/data-bindings`, { body: input }),
    listTaskDataBindings: (taskId) => transport.request<ItemsPage<TaskDataBindingDto>>('GET', `${task(taskId)}/data-bindings`),
    listProjectDataBindings: (projectId, query) => transport.request<ItemsPage<TaskDataBindingDto>>('GET', `${project(projectId)}/data-bindings`, { query }),
    decideDataBinding: (bindingId, input) => transport.request<TaskDataBindingDto>('POST', `/v1/data-bindings/${segment(bindingId)}/decision`, { body: input }),
    revokeDataBinding: (bindingId) => transport.request<TaskDataBindingDto>('POST', `/v1/data-bindings/${segment(bindingId)}/revoke`),
  };
}
