import { DomainTopic } from '@crewstation/contracts';
import type { EventConsumer } from '@crewstation/eventbus';
import { createEventConsumer } from '@crewstation/eventbus';
import type { Logger } from '@crewstation/kernel';
import { noopLogger } from '@crewstation/kernel';
import type { Actor, ProjectDeletionContext, ProjectId, UserId } from '@crewstation/contracts';
import type { AppEnv } from '@crewstation/http';
import type { Database } from '@crewstation/persistence';
import { readMigrationDir } from '@crewstation/persistence';
import type { MigrationSet } from '@crewstation/persistence';
import type { Hono } from 'hono';
import type { Worker } from '@crewstation/queue';
import { createWorker, enqueueJob } from '@crewstation/queue';
import type { ProvisioningModuleApi } from './api/moduleApi';
import type { NamespaceCleanup } from './ports/namespaceCleanup';
import { deleteNamespace } from './application/deleteNamespace';
import { provisionProjectUseCase } from './application/provisionProject';
import { reapplyNamespacesUseCase } from './application/reapplyNamespaces';
import { provisioningRoutes } from './http/provisioningRoutes';
import type { ExternalSteps } from './api/steps';
import type { NamespaceSettings } from './application/namespaceRecords';
import { namespaceRecords } from './application/namespaceRecords';
import type { NamespaceLedger } from './ports/ledger';
import { PROVISION_JOB_KIND, provisionJobHandler } from './workers/provisionHandler';
import type { StartupTask } from './workers/namespaceReapply';
import { namespaceReapplyTask } from './workers/namespaceReapply';
import type { ProjectDeletionOwner } from '@crewstation/contracts';
import type { ProjectDeletionIntents } from './ports/projectDeletions';
import { projectDeletionController } from './application/deletion/controller';
import { projectDeletionRoutes } from './http/projectDeletionRoutes';
import { deletionEnqueue, projectDeletionRuntime } from './workers/projectDeletionRuntime';
import { provisioningProjectWork } from './adapters/persistence/projectAdmission';
import type { ProvisioningCallbackProcesses, ProvisioningProjectWork } from './ports/projectWork';
import { enqueueWithOriginalWork, namespaceWithOriginalWork, projectWorkSteps, provisionWithOriginalWork } from './application/projectWorkSteps';
import { projectWorkObserver } from './workers/projectWorkObserver';

export interface ProvisioningModuleDeps {
  db: Database;
  steps: ExternalSteps;
  /** 资源中心的写入口（RFC-025 第四期）：命名空间与网络策略写成台账记录，由调和器建出。 */
  ledger: NamespaceLedger;
  namespaces: NamespaceSettings;
  cleanup?: NamespaceCleanup;
  workerOwner: string;
  consumerName: string;
  isAdmin: (userId: UserId) => Promise<boolean>;
  logger?: Logger;
  authorizeRetry?: (actor: Actor, projectId: ProjectId) => Promise<void>;
  /** 仅在全部 owner 接齐后组合；未提供时不开放永久删除 HTTP 或工作器。 */
  deletion?: { intents: ProjectDeletionIntents; owners: readonly ProjectDeletionOwner[] };
  projectWork?: { processes: ProvisioningCallbackProcesses; assertAvailable(id: ProjectId): Promise<void>; assertGrant(context: ProjectDeletionContext): Promise<void> };
}

export interface ProvisioningModule {
  readonly api: ProvisioningModuleApi;
  readonly http: Hono<AppEnv>[];
  readonly workers: Worker[];
  /** 启动时跑一次的任务：目前只有命名空间重下发（RFC-018）。与 workers 分开，因为它不认领队列作业。 */
  readonly startupTasks: StartupTask[];
  readonly subscriptions: EventConsumer;
  readonly migrations: MigrationSet;
  readonly projectWork?: ProvisioningProjectWork;
}

const migrations: MigrationSet = { module: 'provisioning', layer: 6, files: readMigrationDir(new URL('./adapters/persistence/migrations', import.meta.url).pathname) };

export function createProvisioningModule(deps: ProvisioningModuleDeps): ProvisioningModule {
  const logger = deps.logger ?? noopLogger;
  const work = deps.projectWork ? provisioningProjectWork({ ...deps.projectWork, db: deps.db }) : undefined;
  const namespaces = namespaceRecords(deps.ledger, deps.namespaces, work ? (facts) => work.checkCurrent(facts.projectId) : undefined);
  const provision = provisionWithOriginalWork(work, deps.steps, provisionProjectUseCase(projectWorkSteps(work, deps.steps, namespaces.ensure), logger));
  const declare = namespaceWithOriginalWork(work, namespaces.declare);
  const reapply = reapplyNamespacesUseCase({ ...deps.steps, ensureNamespace: declare }, logger);
  const enqueue = enqueueWithOriginalWork(work, deps.steps, async (projectId) => { await enqueueJob(deps.db, PROVISION_JOB_KIND, { projectId }, { dedupKey: projectId, maxAttempts: 5 }); });
  const deletions = deps.deletion ? projectDeletionController({ ...deps.deletion, isAdmin: deps.isAdmin, logger, workerOwner: `${deps.workerOwner}.deletion`, enqueue: deletionEnqueue(deps.db) }) : undefined;
  const deletionRuntime = deletions ? projectDeletionRuntime(deps.db, deletions, deps.workerOwner, logger) : undefined;
  const api: ProvisioningModuleApi = { name: 'provisioning', deleteNamespace: (actor, id) => deleteNamespace(deps.cleanup, deps.isAdmin, actor, id), provisionProject: provision, retry: enqueue, reapplyNamespaces: reapply,
    reapplyProjectNamespace: async (id) => { const facts = await deps.steps.loadProject(id); if (!facts || facts.state === 'archived' || facts.state === 'deleting') return; await declare(facts); },
  };
  return {
    migrations, ...(work ? { projectWork: work } : {}),
    api: { ...api, ...(deletions ? { deletions } : {}) },
    http: [provisioningRoutes(api, deps.isAdmin, deps.authorizeRetry), ...(deletions ? [projectDeletionRoutes(deletions, deps.isAdmin)] : [])],
    workers: [createWorker({ db: deps.db, kinds: [PROVISION_JOB_KIND], owner: deps.workerOwner, concurrency: 2, leaseSeconds: 600, logger, handler: provisionJobHandler(api) }), ...(deletionRuntime ? [deletionRuntime.worker] : [])],
    startupTasks: [namespaceReapplyTask(reapply, logger), ...(work ? [projectWorkObserver(work, logger)] : []), ...(deletionRuntime ? [deletionRuntime.recovery] : [])],
    subscriptions: (() => {
      const consumer = createEventConsumer({ db: deps.db, consumer: deps.consumerName, logger }).on(DomainTopic.projectCreated, async (e) => { await enqueue(e.payload.projectId, true); });
      if (deletions) consumer.on(DomainTopic.projectDeletionRequested, async (e) => { await deletions.enqueue(e.payload.operationId); }); return consumer;
    })(),
  };
}
