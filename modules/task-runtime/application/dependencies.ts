import type { Clock, Logger } from '@crewstation/kernel';
import type { TaskCluster } from '../ports/cluster';
import type { EnvironmentSources, ProfileCatalog, ProjectAuthorizer, QuotaSource, ServiceResolver, TaskRuntimeSettings } from '../ports/platform';
import type { UnitOfWork } from '../ports/unitOfWork';

export interface TaskRuntimeUseCaseDeps {
  uow: UnitOfWork;
  cluster: TaskCluster;
  authorizer: ProjectAuthorizer;
  quotas: QuotaSource;
  profiles: ProfileCatalog;
  services: ServiceResolver;
  sources: EnvironmentSources;
  settings: TaskRuntimeSettings;
  clock: Clock;
  logger: Logger;
}
