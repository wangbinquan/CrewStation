import type { Clock } from '@crewstation/kernel';
import type { HostNaming } from '../ports/hostNaming';
import type { ProjectAuthorizer } from '../ports/projectAuthorizer';
import type { ServiceResolver } from '../ports/serviceResolver';
import type { UnitOfWork } from '../ports/unitOfWork';
import type { UserDirectory } from '../ports/userDirectory';

export interface ApiCatalogUseCaseDeps {
  uow: UnitOfWork;
  services: ServiceResolver;
  projects: ProjectAuthorizer;
  hosts: HostNaming;
  clock: Clock;
  /** 可选：申请人／审批人名字；缺省时 DTO 只有 ID。 */
  users?: UserDirectory;
}
