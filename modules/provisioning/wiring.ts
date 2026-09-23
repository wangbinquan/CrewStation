import { DomainTopic } from '@crewstation/contracts';
import type { EventConsumer } from '@crewstation/eventbus';
import { createEventConsumer } from '@crewstation/eventbus';
import type { Logger } from '@crewstation/kernel';
import { noopLogger } from '@crewstation/kernel';
import type { Actor, ProjectId, UserId } from '@crewstation/contracts';
import type { AppEnv } from '@crewstation/http';
import type { Database } from '@crewstation/persistence';
import type { Hono } from 'hono';
import type { Worker } from '@crewstation/queue';
import { createWorker, enqueueJob } from '@crewstation/queue';
import type { ProvisioningModuleApi } from './api/moduleApi';
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

export interface ProvisioningModuleDeps {
  db: Database;
  steps: ExternalSteps;
  /** 资源中心的写入口（RFC-025 第四期）：命名空间与网络策略写成台账记录，由调和器建出。 */
  ledger: NamespaceLedger;
  namespaces: NamespaceSettings;
  workerOwner: string;
  consumerName: string;
  isAdmin: (userId: UserId) => Promise<boolean>;
  logger?: Logger;
  authorizeRetry?: (actor: Actor, projectId: ProjectId) => Promise<void>;
}

export interface ProvisioningModule {
  readonly api: ProvisioningModuleApi;
  readonly http: Hono<AppEnv>[];
  readonly workers: Worker[];
  /** 启动时跑一次的任务：目前只有命名空间重下发（RFC-018）。与 workers 分开，因为它不认领队列作业。 */
  readonly startupTasks: StartupTask[];
  readonly subscriptions: EventConsumer;
}

export function createProvisioningModule(deps: ProvisioningModuleDeps): ProvisioningModule {
  const logger = deps.logger ?? noopLogger;
  const namespaces = namespaceRecords(deps.ledger, deps.namespaces);
  const provision = provisionProjectUseCase({ ...deps.steps, ensureNamespace: namespaces.ensure }, logger);
  const reapply = reapplyNamespacesUseCase({ ...deps.steps, ensureNamespace: namespaces.declare }, logger);
  const enqueue = async (projectId: string): Promise<void> => { await enqueueJob(deps.db, PROVISION_JOB_KIND, { projectId }, { dedupKey: projectId, maxAttempts: 5 }); };
  const api: ProvisioningModuleApi = { name: 'provisioning', provisionProject: provision, retry: enqueue, reapplyNamespaces: reapply };
  return {
    api,
    http: [provisioningRoutes(api, deps.isAdmin, deps.authorizeRetry)],
    workers: [createWorker({ db: deps.db, kinds: [PROVISION_JOB_KIND], owner: deps.workerOwner, concurrency: 2, leaseSeconds: 600, logger, handler: provisionJobHandler(api) })],
    startupTasks: [namespaceReapplyTask(reapply, logger)],
    subscriptions: createEventConsumer({ db: deps.db, consumer: deps.consumerName, logger }).on(DomainTopic.projectCreated, async (e) => { await enqueue(e.payload.projectId); }),
  };
}
