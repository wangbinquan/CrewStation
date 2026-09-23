import { kubernetesSlotControl } from './adapters/k8s/slotControl';
import { slotMaintenanceUseCases } from './application/slotMaintenance';
import { slotLifecycleUseCases } from './application/slotLifecycle';
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
import type { ConfigSource, DataSource, HostNaming, MaintenanceWindow, PlanCatalog, ProjectAuthorizer, ProjectOwners, ReleaseSettings, ServiceResolver, SlotNotifier } from './ports/platform';
import type { ReleaseTagger, RepoReader } from './ports/sourceControl';
import { PIPELINE_JOB_KIND, pipelineJobHandler } from './workers/pipelineHandler';

export interface ReleaseModuleDeps {
  physicalOperationId?: (id: string) => Promise<string>;
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
  /** RFC-021：项目完整维护即破坏性迁移窗口（gateway）；提醒发给负责人（project）经通知端口。 */
  maintenance: MaintenanceWindow;
  owners: ProjectOwners;
  notifier: SlotNotifier;
  isAdmin: (userId: UserId) => Promise<boolean>;
  settings: ReleaseSettings & { builderImage: string; buildkitAddress: string; workerOwner: string };
  /** 测试可替换的交付适配器；默认用 Kubernetes 实现。 */
  delivery?: { builder?: ImageBuilder; migrator?: MigrationRunner; deployer?: SlotDeployer };
  clock?: Clock;
  logger?: Logger;
}

/** 定时器形态的后台任务（与开发会话空闲提醒同一种写法）。 */
export interface ReleaseTimer { start(): void; stop(): Promise<void> }

export interface ReleaseModule {
  readonly api: ReleaseModuleApi;
  readonly http: Hono<AppEnv>[];
  readonly workers: Array<Worker | ReleaseTimer>;
  readonly migrations: MigrationSet;
}

/** 自动下线巡检的间隔：提醒与下线都以小时计，一分钟一轮足够（RFC-021 design §3）。 */
const SLOT_SWEEP_INTERVAL_MS = 60_000;

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
    maintenance: deps.maintenance,
    owners: deps.owners,
    notifier: deps.notifier,
    settings: deps.settings,
    clock: deps.clock ?? systemClock,
    logger,
  };
  const api: ReleaseModuleApi = {
    name: 'release',
    ...slotMaintenanceUseCases({ ...useCaseDeps, slotControl: kubernetesSlotControl(deps.k8s, deps.physicalOperationId), isAdmin: deps.isAdmin }),
    publish: publishUseCase(useCaseDeps),
    switchTraffic: switchTrafficUseCase(useCaseDeps),
    ...releaseQueries(useCaseDeps),
    runPipelineStep: pipelineStepUseCase(useCaseDeps),
    ...slotLifecycleUseCases({ ...useCaseDeps, isAdmin: deps.isAdmin }),
  };
  let timer: ReturnType<typeof setInterval> | undefined;
  const sweep: ReleaseTimer = {
    start: () => { timer ??= setInterval(() => void api.sweepSlotLifecycle().catch((error: unknown) => logger.error('slot lifecycle sweep failed', { error: String(error) })), SLOT_SWEEP_INTERVAL_MS); },
    stop: async () => { if (timer) clearInterval(timer); timer = undefined; },
  };
  return {
    api,
    http: [releaseRoutes(api, deps.isAdmin)],
    workers: [createWorker({ db: deps.db, kinds: [PIPELINE_JOB_KIND], owner: deps.settings.workerOwner, concurrency: 4, logger, handler: pipelineJobHandler(api, jobs) }), sweep],
    migrations: releaseMigrations,
  };
}
