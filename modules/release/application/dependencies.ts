import type { Clock, Logger } from '@crewstation/kernel';
import type { ImageBuilder, MigrationRunner, ReleaseJobs, SlotDeployer } from '../ports/delivery';
import type { ConfigSource, DataSource, HostNaming, MaintenanceWindow, PlanCatalog, ProjectAuthorizer, ProjectOwners, ReleaseSettings, ServiceResolver, SlotNotifier } from '../ports/platform';
import type { ReleaseTagger, RepoReader } from '../ports/sourceControl';
import type { UnitOfWork } from '../ports/unitOfWork';

export interface ReleaseUseCaseDeps {
  uow: UnitOfWork;
  tagger: ReleaseTagger;
  repo: RepoReader;
  builder: ImageBuilder;
  migrator: MigrationRunner;
  deployer: SlotDeployer;
  jobs: ReleaseJobs;
  authorizer: ProjectAuthorizer;
  services: ServiceResolver;
  plans: PlanCatalog;
  config: ConfigSource;
  data: DataSource;
  hosts: HostNaming;
  maintenance: MaintenanceWindow;
  owners: ProjectOwners;
  notifier: SlotNotifier;
  settings: ReleaseSettings;
  clock: Clock;
  logger: Logger;
}
