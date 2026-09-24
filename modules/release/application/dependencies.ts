import type { Clock, Logger } from '@crewstation/kernel';
import type { ImageBuilder, MigrationRunner, ReleaseJobs, SlotDeployer, SlotRenderer } from '../ports/delivery';
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
  /**
   * RFC-025 T8：服务槽由资源中心建出——部署、重新部署只把期望（镜像、端口、副本、资源、环境 Secret 名）随槽状态写进台账，
   * 调和器建对象、建 Secret 时向本模块要环境；流水线照台账判铺开。不给就照旧由本模块部署（用例、回退）。renderer 是这时的集群预检。
   */
  creation?: 'ledger';
  renderer?: SlotRenderer;
}
