import type { Clock, Logger } from '@crewstation/kernel';
import type { UnitOfWork } from '../ports/repositories';
import type { BusinessTaskSettings, ComputeCatalog, Environments, ProjectAuthorizer, Runner, ServiceDirectory } from '../ports/runtime';
import type { TaskId } from '@crewstation/contracts';

export interface BusinessTaskUseCaseDeps {
  /** Legacy background launches must join the same persistent admission barrier as HTTP writes. */
  legacyDispatch?<T>(taskId: TaskId, run: () => Promise<T>): Promise<T | undefined>;
  uow: UnitOfWork;
  environments: Environments;
  runner: Runner;
  directory: ServiceDirectory;
  authorizer: ProjectAuthorizer;
  compute: ComputeCatalog;
  settings: BusinessTaskSettings;
  clock: Clock;
  logger: Logger;
}
