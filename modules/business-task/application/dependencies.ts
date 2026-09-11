import type { Clock, Logger } from '@crewstation/kernel';
import type { UnitOfWork } from '../ports/repositories';
import type { BusinessTaskSettings, Environments, ProjectAuthorizer, Runner, ServiceDirectory } from '../ports/runtime';

export interface BusinessTaskUseCaseDeps {
  uow: UnitOfWork;
  environments: Environments;
  runner: Runner;
  directory: ServiceDirectory;
  authorizer: ProjectAuthorizer;
  settings: BusinessTaskSettings;
  clock: Clock;
  logger: Logger;
}
