import type { Clock, Logger } from '@crewstation/kernel';
import type { TaskCluster } from '../ports/cluster';
import type { EnvironmentSources, ProfileCatalog, ProjectAuthorizer, QuotaSource, ServiceResolver, SourceCheckoutSource, TaskRuntimeSettings } from '../ports/platform';
import type { UnitOfWork } from '../ports/unitOfWork';

export interface TaskRuntimeUseCaseDeps {
  uow: UnitOfWork;
  cluster: TaskCluster;
  authorizer: ProjectAuthorizer;
  quotas: QuotaSource;
  profiles: ProfileCatalog;
  services: ServiceResolver;
  sources: EnvironmentSources;
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
