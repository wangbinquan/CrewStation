import type { Clock } from '@crewstation/kernel';
import type { ProjectAuthorizer } from '../ports/projectAuthorizer';
import type { UnitOfWork } from '../ports/unitOfWork';

export interface EgressUseCaseDeps {
  uow: UnitOfWork;
  authorizer: ProjectAuthorizer;
  clock: Clock;
}
