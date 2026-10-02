import { releaseImageHistory } from './adapters/persistence/drizzleRepositories';
import { releaseProjectContent } from './adapters/persistence/projectContent';
import type { ReleaseContentDirectory } from './ports/repositories';
import type { ExecutionHandoff } from './ports/executionHandoff';
import { releaseHandoffUseCases } from './application/execution/handoff';
import { periodicJob } from '@crewstation/resource-runtime';
import type { ReleaseRuntimeImages } from './ports/runtimeImages';
import { kubernetesSlotControl } from './adapters/k8s/slotControl';
import { slotMaintenanceUseCases } from './application/slotMaintenance';
import { slotLifecycleUseCases } from './application/slotLifecycle';
import { join } from 'node:path';
import type { ReleaseId, UserId } from '@crewstation/contracts';
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
import { drizzleUnitOfWork, releaseProjectAdmissions } from './adapters/persistence/drizzleUnitOfWork';
import { queueReleaseJobs } from './adapters/queue/releaseJobs';
import type { ProjectDeletionContext } from '@crewstation/contracts';
import type { ReleaseCallbackProcess } from './domain/release';
import type { ReleaseDeletionPhysics } from './ports/unitOfWork';
import { releaseDeletionRepository } from './adapters/persistence/projectDeletion';
import { admittedReleaseApi, protectedReleaseEffects, releaseProjectWork, releaseProjectDeletionOwner } from './application/projectDeletion';
import type { ReleaseModuleApi } from './api/moduleApi';
import type { ReleaseUseCaseDeps } from './application/dependencies';
import { pipelineStepUseCase } from './application/pipeline';
import { publishUseCase } from './application/publish';
import { activeWebhookIngress, releaseObjectStorage, releaseQueries } from './application/queries';
import { switchTrafficUseCase } from './application/switchTraffic';
import { releaseRoutes } from './http/releaseRoutes';
import type { ImageBuilder, MigrationRunner, SlotDeployer, SlotRenderer } from './ports/delivery';
import { slotOwnerUseCases } from './application/slotOwners';
import type { ConfigSource, DataSource, HostNaming, MaintenanceWindow, PlanCatalog, ProjectAuthorizer, ProjectOwners, ReleaseSettings, ServiceResolver, SlotNotifier } from './ports/platform';
import type { ReleaseTagger, RepoReader } from './ports/sourceControl';
import { PIPELINE_JOB_KIND, pipelineJobHandler } from './workers/pipelineHandler';
import { slotLedgerResyncWorker } from './workers/slotLedgerResync';
import { resyncSlotLedger } from './application/slotLedgerResync';
import type { SlotLedger } from './ports/ledger';

export interface ReleaseModuleDeps {
  /** Only old retained identities use this directory; normal release commands keep their UUID boundary. */
  deletionIdentities?: ReleaseContentDirectory;
  projectAdmission?: { protectCurrent(): Promise<ReleaseCallbackProcess>; assertAvailable(projectId: string): Promise<void> };
  deletion?: { physics: ReleaseDeletionPhysics; assertGrant(context: ProjectDeletionContext): Promise<void> };
  executionHandoff?: ExecutionHandoff;
  runtimeImages?: ReleaseRuntimeImages;
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
  /** 资源台账（RFC-025 第三期）：给了就把服务槽投影进台账（保存槽的同一事务），并定期补投影。 */
  ledger?: SlotLedger;
  /**
   * RFC-025 T8：'ledger' 时服务槽由资源中心建出（部署只写期望，环境在调和器建 Secret 时向本模块要），renderer 是这时的集群预检；
   * 要配了 ledger 才生效。不给就照旧由本模块部署（用例、回退）。
   */
  creation?: 'ledger';
  renderer?: SlotRenderer;
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
  const admission = deps.projectAdmission ? releaseProjectAdmissions({ db: deps.db, ...deps.projectAdmission }) : undefined;
  const uow = drizzleUnitOfWork(deps.db, deps.ledger ? { ledger: deps.ledger, services: deps.services, logger } : undefined);
  const effects = <T extends object>(source: T) => protectedReleaseEffects(source, admission);
  const jobs = queueReleaseJobs(deps.db, admission ? async (id, work) => {
    const release = await uow.read.releases.getById(id as ReleaseId); if (!release) return;
    await releaseProjectWork({ services: deps.services, admission }, release.serviceId, 'pipeline', release.id, { enqueue: release.id }, async () => {
      if ((await deps.services.resolveServiceById(release.serviceId))?.projectId !== release.projectId) throw new Error('原发布项目与队列服务归属冲突');
      await admission.checkCurrent(); await work(); await admission.checkCurrent();
    });
  } : undefined);
  const useCaseDeps: ReleaseUseCaseDeps = {
    uow, admission,
    tagger: effects(deps.tagger),
    repo: effects(deps.repo), executionHandoff: deps.executionHandoff ? effects(deps.executionHandoff) : undefined,
    ...(deps.runtimeImages ? { runtimeImages: effects(deps.runtimeImages) } : {}),
    builder: effects(deps.delivery?.builder ?? buildKitBuilder(deps.k8s, { builderImage: deps.settings.builderImage, buildkitAddress: deps.settings.buildkitAddress, timeoutSeconds: deps.settings.buildTimeoutSeconds })),
    migrator: effects(deps.delivery?.migrator ?? migrationJobRunner(deps.k8s, { timeoutSeconds: deps.settings.buildTimeoutSeconds })),
    deployer: effects(deps.delivery?.deployer ?? kubernetesSlotDeployer(deps.k8s)),
    jobs,
    authorizer: deps.authorizer,
    services: deps.services,
    plans: deps.plans,
    config: effects(deps.config),
    data: effects(deps.data),
    hosts: deps.hosts,
    maintenance: deps.maintenance,
    owners: deps.owners,
    notifier: effects(deps.notifier),
    settings: deps.settings,
    clock: deps.clock ?? systemClock,
    logger,
    ...(deps.ledger && deps.creation === 'ledger' ? { creation: 'ledger' as const } : {}), ...(deps.renderer ? { renderer: effects(deps.renderer) } : {}),
  };
  const implementation: ReleaseModuleApi = {
    name: 'release',
    ...(deps.deletion && admission ? { deletionOwner: releaseProjectDeletionOwner({
      repository: releaseDeletionRepository({ db: deps.db, services: deps.services, identities: deps.deletionIdentities, assertGrant: deps.deletion.assertGrant }),
      physics: deps.deletion.physics, assertGrant: deps.deletion.assertGrant,
    }) } : {}),
    deletionContent: releaseProjectContent({ db: deps.db, services: deps.services, identities: deps.deletionIdentities }),
    activeWebhookIngress: activeWebhookIngress(useCaseDeps.uow.read),
    objectStorageContract: releaseObjectStorage(useCaseDeps.uow.read),
    imageHistory: releaseImageHistory(deps.db),
    ...releaseHandoffUseCases(useCaseDeps),
    ...slotMaintenanceUseCases({ ...useCaseDeps, slotControl: effects(kubernetesSlotControl(deps.k8s, deps.physicalOperationId)), isAdmin: deps.isAdmin }),
    publish: publishUseCase(useCaseDeps),
    switchTraffic: switchTrafficUseCase(useCaseDeps),
    ...releaseQueries(useCaseDeps),
    runPipelineStep: pipelineStepUseCase(useCaseDeps),
    ...slotLifecycleUseCases({ ...useCaseDeps, isAdmin: deps.isAdmin }),
    ...slotOwnerUseCases(useCaseDeps),
  };
  const api = admittedReleaseApi(useCaseDeps, implementation);
  let timer: ReturnType<typeof setInterval> | undefined;
  const sweep: ReleaseTimer = {
    start: () => { timer ??= setInterval(() => void api.sweepSlotLifecycle().catch((error: unknown) => logger.error('slot lifecycle sweep failed', { error: String(error) })), SLOT_SWEEP_INTERVAL_MS); },
    stop: async () => { if (timer) clearInterval(timer); timer = undefined; },
  };
  return {
    api,
    http: [releaseRoutes(api, deps.isAdmin)],
    workers: [createWorker({ db: deps.db, kinds: [PIPELINE_JOB_KIND], owner: deps.settings.workerOwner, concurrency: 4, logger, handler: pipelineJobHandler(api, jobs) }), sweep, periodicJob(() => api.progressHandoffs().then(() => undefined), (error) => logger.warn('execution handoff progress failed', { error: String(error) }), 1000),
      ...(deps.ledger ? [slotLedgerResyncWorker(() => resyncSlotLedger(useCaseDeps.uow, logger, useCaseDeps), logger)] : [])],
    migrations: releaseMigrations,
  };
}
