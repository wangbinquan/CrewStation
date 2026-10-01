import type { Actor, DataEnv, DataResourceDto, DecideTaskDataBinding, ProjectId, RequestTaskDataBinding, ServiceId, TaskDataBindingDto, TaskDataBindingState, TaskId } from '@crewstation/contracts';
import type { ObjectStorageAdminApi } from './objectStorageApi';
import type { ObjectServiceApi } from './objectServiceApi';
import type { ArchiveFinalizationApi } from './archiveFinalizationApi';
import type { ArchiveHelperApi } from './archiveHelperApi';
import type { ArchiveAdministrationApi } from './archiveAdministrationApi';
import type { ArchiveServiceApi } from './archiveServiceApi';
import type { TaskInputApi } from './taskInputApi';
import type { ResourceTargetDescription, ResourceValues, UserId } from '@crewstation/contracts';

/** data 模块对外能力：服务数据供给与环境变量渲染、开发会话的数据访问绑定。 */
export interface DataModuleApi {
  /** Internal retained-history read; does not issue credentials or prove physical absence. */
  readonly nativePostgresHistory?: { read(projectId: ProjectId): Promise<DataNativePostgresHistory> };
  readonly storageContract: { version: number; check(): Promise<{ requiredVersion: number; enabled: boolean }>; enable(): Promise<void> };
  readonly name: 'data';
  inspectProductionAccess(actor: Actor, projectId: ProjectId, taskId: TaskId): Promise<ResourceTargetDescription>;
  listProductionAccessTargets(actor: Actor, projectId: ProjectId): Promise<ResourceTargetDescription[]>;
  applyProductionAccess(actor: Actor, projectId: ProjectId, input: { operationId: string; taskId: TaskId; expectedRevision: string; values: ResourceValues; requestedBy: UserId; reason: string }): Promise<{ revision: string; effect: string; applied: boolean }>;
  observeProductionAccess(projectId: ProjectId, operationId: string): Promise<{ revision: string; effect: string; applied: boolean }>;
  productionAccessReceipt(projectId: ProjectId, operationId: string): Promise<{ revision: string; effect: string; applied: boolean } | undefined>;
  taskStorageStatus(serviceId: ServiceId): Promise<{ available: boolean; reason: string | null }>;
  readonly objects?: ObjectStorageAdminApi;
  readonly taskInputs?: TaskInputApi;
  readonly objectService?: ObjectServiceApi;
  readonly archiveFinalization?: ArchiveFinalizationApi;
  readonly archiveHelper?: ArchiveHelperApi;
  readonly archiveService?: ArchiveServiceApi;
  readonly archiveAdministration?: ArchiveAdministrationApi;
  /** Internal module handshake; not exposed as a user/service HTTP mutation. */
  applyObjectWriteControl(input: { serviceId: ServiceId; controlVersion: number; epoch: number; leaseId: string; instanceId: string; podUid: string | null; leaseUntil: string; phase: 'active' | 'frozen' }): Promise<boolean>;
  objectEnv?(serviceId: ServiceId, env: DataEnv, planId: string): Promise<Record<string, string>>;
  ensureServiceData(serviceId: ServiceId): Promise<DataResourceDto[]>;
  envFor(serviceId: ServiceId, env: DataEnv): Promise<Record<string, string>>;
  listResources(actor: Actor, projectId: ProjectId): Promise<DataResourceDto[]>;
  rotateCredential(actor: Actor, resourceId: string): Promise<DataResourceDto>;
  requestTaskBinding(actor: Actor, ids: { taskId: TaskId; serviceId: ServiceId }, input: RequestTaskDataBinding): Promise<TaskDataBindingDto>;
  decideTaskBinding(actor: Actor, bindingId: string, input: DecideTaskDataBinding): Promise<TaskDataBindingDto>;
  revokeTaskBinding(actor: Actor, bindingId: string, input?: Pick<DecideTaskDataBinding, 'decision'>): Promise<TaskDataBindingDto>;
  listTaskBindings(actor: Actor, taskId: TaskId): Promise<TaskDataBindingDto[]>;
  listProjectBindings(actor: Actor, projectId: ProjectId, states?: TaskDataBindingState[]): Promise<TaskDataBindingDto[]>;
  envForTask(taskId: TaskId): Promise<Record<string, string>>;
  expireBindings(): Promise<number>;
}

export interface DataNativePostgresDsn {
  readonly state: 'absent' | 'available' | 'unreadable' | 'invalid' | 'not-applicable';
  readonly ciphertextDigest: string | null;
  readonly origin: { readonly hostname: string; readonly port: number; readonly database: string; readonly role: string } | null;
}
interface DataNativePostgresRecord {
  readonly id: string;
  readonly serviceId: string;
  readonly state: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly dsn: DataNativePostgresDsn;
}
export interface DataNativePostgresHistory {
  readonly projectId: ProjectId;
  /** Only retained tables are complete; missing DSNs/OIDs require independent history. */
  readonly retainedRecordsComplete: true;
  readonly revision: string;
  readonly resources: readonly (DataNativePostgresRecord & { readonly kind: string; readonly env: string; readonly objectName: string })[];
  readonly bindings: readonly (DataNativePostgresRecord & { readonly taskId: string; readonly legacyResourceId: string | null; readonly mode: string; readonly roleName: string | null; readonly expiresAt: string | null })[];
  readonly aliases: readonly { readonly kind: 'data-resource' | 'data-binding' | 'unknown'; readonly id: string; readonly keys: readonly string[]; readonly valid: boolean }[];
  readonly gaps: readonly { readonly source: 'resource' | 'binding' | 'alias'; readonly id: string; readonly code: 'legacy-row-invalid' | 'legacy-name-invalid' | 'legacy-dsn-unreadable' | 'legacy-dsn-invalid' | 'legacy-dsn-conflict' | 'legacy-alias-invalid'; readonly message: string }[];
}
