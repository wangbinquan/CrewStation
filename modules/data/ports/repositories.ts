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
  /** 全部数据资源（台账补投影用）。 */
  listAll(): Promise<DataResource[]>;
}

export interface TaskDataBindingRepository {
  insert(binding: TaskDataBinding): Promise<void>;
  update(binding: TaskDataBinding): Promise<void>;
  getById(id: string): Promise<TaskDataBinding | undefined>;
  listByTask(taskId: TaskId): Promise<TaskDataBinding[]>;
  listByProject(projectId: ProjectId, states?: TaskDataBinding['state'][]): Promise<TaskDataBinding[]>;
  listExpired(now: Date): Promise<TaskDataBinding[]>;
  /** 还没结束的绑定：申请中、已批准、生效中（台账补投影用）。 */
  listOpen(): Promise<TaskDataBinding[]>;
}

interface NativePostgresHistoryRow {
  readonly id: string;
  readonly projectId: string;
  readonly serviceId: string;
  readonly state: string;
  readonly secretBox: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}
/** Private ciphertext stays inside data; both tables are read in one original snapshot. */
export interface NativePostgresHistoryStore {
  read(projectId: ProjectId): Promise<{
    resources: readonly (NativePostgresHistoryRow & { readonly kind: string; readonly env: string; readonly objectName: string })[];
    bindings: readonly (NativePostgresHistoryRow & { readonly taskId: string; readonly legacyResourceId: string | null; readonly mode: string; readonly roleName: string | null; readonly expiresAt: Date | null })[];
  }>;
}
