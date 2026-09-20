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
  clock: Clock;
  logger: Logger;
}
