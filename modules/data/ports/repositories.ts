import type { DataEnv, ProjectId, ServiceId, TaskId } from '@crewstation/contracts';
import type { DataResource } from '../domain/dataResource';
import type { TaskDataBinding } from '../domain/taskDataBinding';

export interface DataResourceRepository {
  insert(resource: DataResource): Promise<void>;
  update(resource: DataResource): Promise<void>;
  getById(id: string): Promise<DataResource | undefined>;
  find(serviceId: ServiceId, env: DataEnv, kind: DataResource['kind']): Promise<DataResource | undefined>;
  listByService(serviceId: ServiceId): Promise<DataResource[]>;
  listByProject(projectId: ProjectId): Promise<DataResource[]>;
}

export interface TaskDataBindingRepository {
  insert(binding: TaskDataBinding): Promise<void>;
  update(binding: TaskDataBinding): Promise<void>;
  getById(id: string): Promise<TaskDataBinding | undefined>;
  listByTask(taskId: TaskId): Promise<TaskDataBinding[]>;
  listByProject(projectId: ProjectId, states?: TaskDataBinding['state'][]): Promise<TaskDataBinding[]>;
  listExpired(now: Date): Promise<TaskDataBinding[]>;
}
