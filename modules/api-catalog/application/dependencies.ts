import type { Clock } from '@crewstation/kernel';
import type { HostNaming } from '../ports/hostNaming';
import type { ProjectAuthorizer } from '../ports/projectAuthorizer';
import type { ServiceResolver } from '../ports/serviceResolver';
import type { UnitOfWork } from '../ports/unitOfWork';

export interface ApiCatalogUseCaseDeps {
  uow: UnitOfWork;
  services: ServiceResolver;
  projects: ProjectAuthorizer;
  hosts: HostNaming;
  clock: Clock;
}
