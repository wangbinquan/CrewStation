import type { DevelopmentCleanupParticipant } from '../ports/developmentCleanup';
import type { TaskRecoveryCluster } from '../ports/recoveryCluster';
import type { RuntimeImageExecutionSnapshot, ServiceId, TaskId, TaskKind, TraceId, UserId, VolumeMode } from '@crewstation/contracts';
import type { Clock, Logger } from '@crewstation/kernel';
import type { TaskCluster } from '../ports/cluster';
import type { EnvironmentSources, ProfileCatalog, ProjectAuthorizer, QuotaSource, ServiceResolver, SourceCheckoutSource, TaskRuntimeSettings, TestRunner } from '../ports/platform';
import type { UnitOfWork } from '../ports/unitOfWork';
import type { DevelopmentParentPhysical } from '../ports/developmentParentPhysical';
import type { WorkloadSafetyPort, TaskVolumePort } from '../ports/workloadSafety';
import type { UnprovisionedStorage } from '../ports/unprovisionedStorage';
import type { RuntimeProjectWork } from '../ports/deletion/work';

export interface TaskRuntimeUseCaseDeps {
  projectWork?: RuntimeProjectWork;
  developmentParentPhysical?: DevelopmentParentPhysical;
  developmentCleanup?: DevelopmentCleanupParticipant;
  unprovisionedStorage?: UnprovisionedStorage;
  workloadSafety?: WorkloadSafetyPort;
  taskVolumes?: TaskVolumePort;
  uow: UnitOfWork;
  cluster: TaskCluster;
  businessStorageInspector?: Pick<TaskRecoveryCluster, 'inspect'>;
  /** Original physical parent identity is read before acquiring Project/Task/Resources locks. */
  developmentParentInspector?: Pick<TaskRecoveryCluster, 'inspect'>;
  authorizer: ProjectAuthorizer;
  quotas: QuotaSource;
  profiles: ProfileCatalog;
  services: ServiceResolver;
  sources: EnvironmentSources;
  initializationRunner?: Pick<TestRunner, 'sendCommand' | 'connectionStatus'>;
  /** Explicit protocol-2 startup alias, persisted before an older image can connect. */
  legacyRunnerTaskId?: (taskId: string) => Promise<string>;
  /** 缺省不检出：业务任务容器不需要源码，单元测试也不需要集群。 */
  checkout?: SourceCheckoutSource;
  settings: TaskRuntimeSettings;
  /**
   * RFC-025 I25：工作区（开发会话、业务任务）的容器由资源中心建出——受理只写期望（不含凭据），调和器照记录建卷、Runner Secret、
   * Pod 与开发预览，建 Secret 时回头要值。不给就由本模块自己建（用例、独立部署）。
   */
  creation?: 'ledger';
  clock: Clock;
  logger: Logger;
}

export interface CreateEnvironmentInput {
  developmentObjectPlanId?: string;
  /** 开发镜像保留引用预先分配的身份，仅内部使用。 */
  runtimeImageTaskId?: TaskId;
  /** 由调用方预留并通过用途验证的不可变镜像快照，不从父任务继承。 */
  runtimeImage?: RuntimeImageExecutionSnapshot;
  businessStorage?: 'isolated-v1';
  completionPolicy?: 'archive-and-delete';
  objectInputsGeneration?: number;
  admission?: { id: TaskId; fingerprint: string };
  serviceId: ServiceId;
  kind: TaskKind;
  volumeMode?: VolumeMode;
  profile?: string;
  branch?: string;
  traceId?: TraceId;
  createdBy?: UserId;
  preview?: { command: string[]; port: number; healthPath: string };
  labels?: Record<string, string>;
}
