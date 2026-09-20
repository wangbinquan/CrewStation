import { drizzleClusterCommands } from './adapters/persistence/clusterCommands';
import { businessClusterUseCases } from './application/clusterManagement';
import { join } from 'node:path';
import type { UserId } from '@crewstation/contracts';
import { DomainTopic } from '@crewstation/contracts';
import type { EventConsumer } from '@crewstation/eventbus';
import { createEventConsumer } from '@crewstation/eventbus';
import type { AppEnv } from '@crewstation/http';
import type { Clock, Logger } from '@crewstation/kernel';
import { noopLogger, systemClock } from '@crewstation/kernel';
import type { Database, MigrationSet } from '@crewstation/persistence';
import { readMigrationDir } from '@crewstation/persistence';
import type { Hono } from 'hono';
import { drizzleUnitOfWork } from './adapters/persistence/drizzleUnitOfWork';
import type { BusinessTaskModuleApi } from './api/moduleApi';
import type { BusinessTaskUseCaseDeps } from './application/dependencies';
import { registerContractsUseCase } from './application/registerContracts';
import { subtaskUseCases } from './application/subtasks';
import { taskLifecycleUseCases } from './application/taskLifecycle';
import { serviceRoutes } from './http/serviceRoutes';
import { userRoutes } from './http/userRoutes';
import type { ComputeCatalog, BusinessTaskSettings, Environments, ProjectAuthorizer, Runner, ServiceDirectory } from './ports/runtime';

export interface BusinessTaskModuleDeps {
  /** 算力档位解析（RFC-001），由组合根接到 project。 */
  compute: ComputeCatalog;
  db: Database;
  environments: Environments;
  runner: Runner;
  directory: ServiceDirectory;
  authorizer: ProjectAuthorizer;
  isAdmin: (userId: UserId) => Promise<boolean>;
  settings: BusinessTaskSettings & { consumerName: string };
  clock?: Clock;
  logger?: Logger;
}

export interface BusinessTaskModule {
  readonly api: BusinessTaskModuleApi;
  readonly http: { service: Hono<AppEnv>; user: Hono<AppEnv> };
  readonly subscriptions: EventConsumer;
  readonly workers: Array<{ start(): void; stop(): Promise<void> }>;
  readonly migrations: MigrationSet;
}

export const businessTaskMigrations: MigrationSet = {
  module: 'business_task',
  layer: 5,
  files: readMigrationDir(join(import.meta.dir, 'adapters', 'persistence', 'migrations')),
};

export function createBusinessTaskModule(deps: BusinessTaskModuleDeps): BusinessTaskModule {
  const logger = deps.logger ?? noopLogger;
  const useCaseDeps: BusinessTaskUseCaseDeps = {
    uow: drizzleUnitOfWork(deps.db), environments: deps.environments, runner: deps.runner, directory: deps.directory, authorizer: deps.authorizer,
    compute: deps.compute, settings: deps.settings, clock: deps.clock ?? systemClock, logger,
  };
  const lifecycle = taskLifecycleUseCases(useCaseDeps);
  const subtasks = subtaskUseCases(useCaseDeps);
  const registerContracts = registerContractsUseCase(useCaseDeps);
  const api: BusinessTaskModuleApi = {
    name: 'business-task',
    ...businessClusterUseCases(useCaseDeps, drizzleClusterCommands(deps.db)),
    createTask: lifecycle.createTask, getTask: lifecycle.getTask, closeTask: lifecycle.closeTask, pauseTask: lifecycle.pauseTask, resumeTask: lifecycle.resumeTask, listProjectTasks: lifecycle.listProjectTasks,
    ...subtasks,
    registerContracts,
  };
  const subscriptions = createEventConsumer({ db: deps.db, consumer: deps.settings.consumerName, logger })
    .on(DomainTopic.releaseRegistered, async (e) => { await registerContracts(e.payload); });
  let timer: ReturnType<typeof setInterval> | undefined;
  return {
    api,
    http: { service: serviceRoutes(api), user: userRoutes(api, deps.isAdmin) },
    subscriptions,
    workers: [{ start: () => { timer ??= setInterval(() => void subtasks.sweepActive().catch((e: unknown) => logger.error('subtask sweep failed', { error: String(e) })), 5000); }, stop: async () => { if (timer) clearInterval(timer); timer = undefined; } }],
    migrations: businessTaskMigrations,
  };
}
