import { join } from 'node:path';
import type { UserId } from '@crewstation/contracts';
import type { AppEnv } from '@crewstation/http';
import type { K8sClient } from '@crewstation/k8s';
import type { Clock, Logger } from '@crewstation/kernel';
import { noopLogger, systemClock } from '@crewstation/kernel';
import type { Database, MigrationSet } from '@crewstation/persistence';
import { readMigrationDir } from '@crewstation/persistence';
import type { Worker } from '@crewstation/queue';
import { createWorker } from '@crewstation/queue';
import type { Hono } from 'hono';
import { buildKitBuilder } from './adapters/k8s/buildKitBuilder';
import { migrationJobRunner } from './adapters/k8s/migrationJob';
import { kubernetesSlotDeployer } from './adapters/k8s/slotDeployer';
import { drizzleUnitOfWork } from './adapters/persistence/drizzleUnitOfWork';
import { queueReleaseJobs } from './adapters/queue/releaseJobs';
import type { ReleaseModuleApi } from './api/moduleApi';
import type { ReleaseUseCaseDeps } from './application/dependencies';
import { pipelineStepUseCase } from './application/pipeline';
import { publishUseCase } from './application/publish';
import { releaseQueries } from './application/queries';
import { switchTrafficUseCase } from './application/switchTraffic';
import { releaseRoutes } from './http/releaseRoutes';
import type { ImageBuilder, MigrationRunner, SlotDeployer } from './ports/delivery';
import type { ConfigSource, DataSource, HostNaming, PlanCatalog, ProjectAuthorizer, ReleaseSettings, ServiceResolver } from './ports/platform';
import type { ReleaseTagger, RepoReader } from './ports/sourceControl';
import { PIPELINE_JOB_KIND, pipelineJobHandler } from './workers/pipelineHandler';

export interface ReleaseModuleDeps {
  db: Database;
  k8s: K8sClient;
  tagger: ReleaseTagger;
  repo: RepoReader;
  authorizer: ProjectAuthorizer;
  services: ServiceResolver;
  plans: PlanCatalog;
  config: ConfigSource;
  data: DataSource;
  hosts: HostNaming;
  isAdmin: (userId: UserId) => Promise<boolean>;
  settings: ReleaseSettings & { builderImage: string; buildkitAddress: string; workerOwner: string };
  /** 测试可替换的交付适配器；默认用 Kubernetes 实现。 */
  delivery?: { builder?: ImageBuilder; migrator?: MigrationRunner; deployer?: SlotDeployer };
  clock?: Clock;
  logger?: Logger;
}

export interface ReleaseModule {
  readonly api: ReleaseModuleApi;
  readonly http: Hono<AppEnv>[];
  readonly workers: Worker[];
  readonly migrations: MigrationSet;
}

export const releaseMigrations: MigrationSet = {
  module: 'release',
  layer: 4,
  files: readMigrationDir(join(import.meta.dir, 'adapters', 'persistence', 'migrations')),
};

export function createReleaseModule(deps: ReleaseModuleDeps): ReleaseModule {
  const logger = deps.logger ?? noopLogger;
  const jobs = queueReleaseJobs(deps.db);
  const useCaseDeps: ReleaseUseCaseDeps = {
    uow: drizzleUnitOfWork(deps.db),
    tagger: deps.tagger,
    repo: deps.repo,
    builder: deps.delivery?.builder ?? buildKitBuilder(deps.k8s, { builderImage: deps.settings.builderImage, buildkitAddress: deps.settings.buildkitAddress, timeoutSeconds: deps.settings.buildTimeoutSeconds }),
    migrator: deps.delivery?.migrator ?? migrationJobRunner(deps.k8s, { timeoutSeconds: deps.settings.buildTimeoutSeconds }),
    deployer: deps.delivery?.deployer ?? kubernetesSlotDeployer(deps.k8s),
    jobs,
    authorizer: deps.authorizer,
    services: deps.services,
    plans: deps.plans,
    config: deps.config,
    data: deps.data,
    hosts: deps.hosts,
    settings: deps.settings,
    clock: deps.clock ?? systemClock,
    logger,
  };
  const api: ReleaseModuleApi = {
    name: 'release',
    publish: publishUseCase(useCaseDeps),
    switchTraffic: switchTrafficUseCase(useCaseDeps),
    ...releaseQueries(useCaseDeps),
    runPipelineStep: pipelineStepUseCase(useCaseDeps),
  };
  return {
    api,
    http: [releaseRoutes(api, deps.isAdmin)],
    workers: [createWorker({ db: deps.db, kinds: [PIPELINE_JOB_KIND], owner: deps.settings.workerOwner, concurrency: 4, logger, handler: pipelineJobHandler(api, jobs) })],
    migrations: releaseMigrations,
  };
}
