import { join } from 'node:path';
import type { UserId } from '@crewstation/contracts';
import type { AppEnv } from '@crewstation/http';
import type { K8sClient } from '@crewstation/k8s';
import type { Clock, Logger } from '@crewstation/kernel';
import { noopLogger, systemClock } from '@crewstation/kernel';
import type { Database, MigrationSet } from '@crewstation/persistence';
import { readMigrationDir } from '@crewstation/persistence';
import type { Hono } from 'hono';
import { kubernetesTaskCluster } from './adapters/k8s/taskCluster';
import { drizzleUnitOfWork } from './adapters/persistence/drizzleUnitOfWork';
import type { TaskRuntimeModuleApi } from './api/moduleApi';
import { createEnvironmentUseCase } from './application/createEnvironment';
import type { TaskRuntimeUseCaseDeps } from './application/dependencies';
import { lifecycleUseCases } from './application/lifecycle';
import { environmentQueries, environmentToDto } from './application/queries';
import { reconcileUseCase } from './application/reconcile';
import { environmentRoutes } from './http/environmentRoutes';
import type { TaskCluster } from './ports/cluster';
import type { EnvironmentSources, ProfileCatalog, ProjectAuthorizer, QuotaSource, ServiceResolver, TaskRuntimeSettings } from './ports/platform';

export interface TaskRuntimeModuleDeps {
  db: Database;
  k8s: K8sClient;
  authorizer: ProjectAuthorizer;
  quotas: QuotaSource;
  profiles: ProfileCatalog;
  services: ServiceResolver;
  sources: EnvironmentSources;
  isAdmin: (userId: UserId) => Promise<boolean>;
  settings: TaskRuntimeSettings;
  cluster?: TaskCluster;
  clock?: Clock;
  logger?: Logger;
}

export interface TaskRuntimeModule {
  readonly api: TaskRuntimeModuleApi;
  readonly http: Hono<AppEnv>[];
  readonly workers: Array<{ start(): void; stop(): Promise<void> }>;
  readonly migrations: MigrationSet;
}

export const taskRuntimeMigrations: MigrationSet = {
  module: 'task_runtime',
  layer: 4,
  files: readMigrationDir(join(import.meta.dir, 'adapters', 'persistence', 'migrations')),
};

export function createTaskRuntimeModule(deps: TaskRuntimeModuleDeps): TaskRuntimeModule {
  const useCaseDeps: TaskRuntimeUseCaseDeps = {
    uow: drizzleUnitOfWork(deps.db),
    cluster: deps.cluster ?? kubernetesTaskCluster(deps.k8s),
    authorizer: deps.authorizer,
    quotas: deps.quotas,
    profiles: deps.profiles,
    services: deps.services,
    sources: deps.sources,
    settings: deps.settings,
    clock: deps.clock ?? systemClock,
    logger: deps.logger ?? noopLogger,
  };
  const create = createEnvironmentUseCase(useCaseDeps);
  const lifecycle = lifecycleUseCases(useCaseDeps);
  const queries = environmentQueries(useCaseDeps);
  const reconcile = reconcileUseCase(useCaseDeps, lifecycle);
  const api: TaskRuntimeModuleApi = {
    name: 'task-runtime',
    createEnvironment: async (input) => environmentToDto(await create(input)),
    releaseEnvironment: async (taskId, reason) => environmentToDto(await lifecycle.releaseEnvironment(taskId, reason)),
    pauseEnvironment: async (taskId) => environmentToDto(await lifecycle.pauseEnvironment(taskId)),
    resumeEnvironment: async (taskId) => environmentToDto(await lifecycle.resumeEnvironment(taskId)),
    markFailed: lifecycle.markFailed,
    touch: lifecycle.touch,
    onRunnerConnected: lifecycle.onRunnerConnected,
    onRunnerDisconnected: lifecycle.onRunnerDisconnected,
    getEnvironment: async (taskId) => { const env = await queries.getEnvironment(taskId); return env ? environmentToDto(env) : undefined; },
    describeEnvironment: queries.describeEnvironment,
    listEnvironments: queries.listEnvironments,
    findDevSession: async (projectId) => { const env = await queries.findDevSession(projectId); return env ? environmentToDto(env) : undefined; },
    verifyRunnerToken: queries.verifyRunnerToken,
    canOpenStream: queries.canOpenStream,
    reconcile,
  };
  let timer: ReturnType<typeof setInterval> | undefined;
  return {
    api,
    http: [environmentRoutes(api, deps.isAdmin)],
    workers: [{ start: () => { timer ??= setInterval(() => void reconcile().catch((e: unknown) => useCaseDeps.logger.error('reconcile failed', { error: String(e) })), 15000); }, stop: async () => { if (timer) clearInterval(timer); timer = undefined; } }],
    migrations: taskRuntimeMigrations,
  };
}
