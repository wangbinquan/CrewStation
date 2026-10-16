import type { DataEnv, DatabasePhysicalIdentity, ProjectId, ServiceId, TaskId } from '@crewstation/contracts';
import type { DataResource } from '../domain/dataResource';
import type { TaskDataBinding } from '../domain/taskDataBinding';
import type { DatabaseEnvironmentBinding, DatabaseGeneration } from '../domain/databaseGeneration';

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
    aliases: readonly { readonly kind: string; readonly key: string; readonly id: string }[];
  }>;
}

/** RFC-042 physical database generations of one logical resource and the environment binding that selects one. */
export interface DatabaseGenerations {
  ensureInitial(resource: DataResource): Promise<void>;
  active(serviceId: ServiceId, env: DataEnv): Promise<{ binding: DatabaseEnvironmentBinding; generation: DatabaseGeneration } | undefined>;
  get(id: string): Promise<DatabaseGeneration | undefined>;
  list(serviceId: ServiceId): Promise<DatabaseGeneration[]>;
  reserve(input: { id: string; operationId: string; serviceId: ServiceId; expectedGenerationId: string; expectedRevision: number }): Promise<DatabaseGeneration>;
  recordIdentity(id: string, identity: DatabasePhysicalIdentity, emptyProof?: NonNullable<DatabaseGeneration['emptyProof']>): Promise<void>;
  commit(input: { operationId: string; serviceId: ServiceId; sourceGenerationId: string; targetGenerationId: string; expectedRevision: number }): Promise<DatabaseEnvironmentBinding>;
  finish(serviceId: ServiceId, operationId: string): Promise<void>;
  abandon(serviceId: ServiceId, operationId: string): Promise<void>;
  assertUnreserved(serviceId: ServiceId): Promise<void>;
  withUnreserved<T>(serviceId: ServiceId, effect: () => Promise<T>): Promise<T>;
}
export interface DatabaseGenerationPlane {
  inspect(input: { projectId: ProjectId; resourceId: string; databaseName: string }): Promise<{ identity: DatabasePhysicalIdentity; empty: boolean; birthDigest: string | null; provisioning: boolean } | null>;
}
