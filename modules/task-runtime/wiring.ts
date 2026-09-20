import { join } from 'node:path';
import type { UserId } from '@crewstation/contracts';
import type { AppEnv } from '@crewstation/http';
import type { K8sClient } from '@crewstation/k8s';
import { LABELS } from '@crewstation/k8s';
import type { Clock, Logger } from '@crewstation/kernel';
import { noopLogger, systemClock } from '@crewstation/kernel';
import type { Database, MigrationSet } from '@crewstation/persistence';
import { readMigrationDir } from '@crewstation/persistence';
import type { Hono } from 'hono';
import { kubernetesTaskCluster } from './adapters/k8s/taskCluster';
import { kubernetesTaskRecoveryCluster } from './adapters/k8s/taskRecoveryCluster';
import { kubernetesRebuildProvisioner } from './adapters/k8s/rebuildProvisioner';
import { kubernetesNativeExecutions } from './adapters/k8s/nativeExecutions';
import { drizzleUnitOfWork } from './adapters/persistence/drizzleUnitOfWork';
import type { TaskRuntimeModuleApi } from './api/moduleApi';
import { createEnvironmentUseCase } from './application/createEnvironment';
import type { TaskRuntimeUseCaseDeps } from './application/dependencies';
import { lifecycleUseCases } from './application/lifecycle';
import { environmentQueries, environmentToDto } from './application/queries';
import { reconcileUseCase } from './application/reconcile';
import { rebuildUseCases } from './application/requestRebuild';
import { rebuildWorker } from './workers/rebuildWorker';
import { nativeExecutionWorker } from './workers/nativeExecutionWorker';
import { createNativeExecutionUseCase } from './application/nativeExecution';
import { createTestEnvironmentUseCase } from './application/testEnvironment';
import { PROFILE_TEST_LABELS } from './domain/profileTestEnvironment';
import { runProfileTestUseCase } from './application/profileTest';
import type { ProfileTestTiming } from './application/profileTest';
import { environmentRoutes } from './http/environmentRoutes';
import type { TaskCluster } from './ports/cluster';
import type { EnvironmentSources, ProfileCatalog, ProjectAuthorizer, QuotaSource, ServiceResolver, SourceCheckoutSource, TaskRuntimeSettings, TestRunner } from './ports/platform';

export interface TaskRuntimeModuleDeps {
  db: Database;
  k8s: K8sClient;
  authorizer: ProjectAuthorizer;
  quotas: QuotaSource;
  profiles: ProfileCatalog;
  services: ServiceResolver;
  sources: EnvironmentSources;
  /** 开发会话的源码检出；不给则容器里是空工作卷。 */
  checkout?: SourceCheckoutSource;
  /** 档位测试用的 Runner 通道（RFC-006）；不给则测试报“未配置测试执行通道”。 */
  testRunner?: TestRunner;
  testTiming?: Partial<ProfileTestTiming>;
  /** 平台两个 MCP 的服务域地址，供档位测试展开步骤里的 `{{mcp.*}}`（RFC-006 C16）。 */
  testMcp?: ReadonlyArray<{ name: string; url: string }>;
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
    cluster: deps.cluster ?? kubernetesTaskCluster(deps.k8s, deps.settings.workerUid),
    authorizer: deps.authorizer,
    quotas: deps.quotas,
    profiles: deps.profiles,
    services: deps.services,
    sources: deps.sources,
    ...(deps.checkout ? { checkout: deps.checkout } : {}),
    settings: deps.settings,
    clock: deps.clock ?? systemClock,
    logger: deps.logger ?? noopLogger,
  };
  const create = createEnvironmentUseCase(useCaseDeps);
  const lifecycle = lifecycleUseCases(useCaseDeps);
  const queries = environmentQueries(useCaseDeps);
  const reconcile = reconcileUseCase(useCaseDeps, lifecycle);
  const recoveryDeps = { ...useCaseDeps, recoveryCluster: kubernetesTaskRecoveryCluster(deps.k8s), provisioner: kubernetesRebuildProvisioner(deps.k8s, deps.settings.workerUid) };
  const executionDeps = { ...useCaseDeps, nativeCluster: kubernetesNativeExecutions(deps.k8s, deps.settings.workerUid) };
  const createNative = createNativeExecutionUseCase(executionDeps);
  const rebuild = rebuildUseCases(recoveryDeps);
  const createTestEnvironment = createTestEnvironmentUseCase(useCaseDeps);
  const runProfileTest = runProfileTestUseCase(useCaseDeps, {
    createTestEnvironment: (input) => createTestEnvironment({ ...input, labels: { [LABELS.project]: PROFILE_TEST_LABELS.project, [LABELS.service]: PROFILE_TEST_LABELS.service, ...input.labels } }),
    release: (taskId) => lifecycle.releaseEnvironment(taskId, 'profile-test'),
    ...(deps.testRunner ? { runner: deps.testRunner } : {}), ...(deps.testTiming ? { timing: deps.testTiming } : {}), ...(deps.testMcp ? { mcp: deps.testMcp } : {}),
  });
  const api: TaskRuntimeModuleApi = {
    name: 'task-runtime',
    listClusterTasks: queries.listClusterTasks,
    ...rebuild,
    createEnvironment: async (input) => environmentToDto(await create(input)),
    createNativeExecution: async (input) => environmentToDto(await createNative(input)),
    releaseEnvironment: async (taskId, reason) => environmentToDto(await lifecycle.releaseEnvironment(taskId, reason)),
    pauseEnvironment: async (taskId) => environmentToDto(await lifecycle.pauseEnvironment(taskId)),
    resumeEnvironment: async (taskId) => environmentToDto(await lifecycle.resumeEnvironment(taskId)),
    markFailed: lifecycle.markFailed,
    touch: lifecycle.touch,
    onRunnerConnected: lifecycle.onRunnerConnected,
    onRunnerDisconnected: lifecycle.onRunnerDisconnected,
    onRunnerRejected: lifecycle.onRunnerRejected,
    getEnvironment: async (taskId) => { const env = await queries.getEnvironment(taskId); return env ? environmentToDto(env) : undefined; },
    describeEnvironment: queries.describeEnvironment,
    listEnvironments: queries.listEnvironments,
    findDevSession: async (projectId, options) => { const env = await queries.findDevSession(projectId, options); return env ? environmentToDto(env) : undefined; },
    listRunningDevSessions: async () => (await queries.listRunningDevSessions()).map(environmentToDto),
    runningTaskCount: (projectId) => useCaseDeps.uow.read.admissions.running(projectId),
    listByTrace: async (traceId) => (await useCaseDeps.uow.read.environments.listByTrace(traceId)).map(environmentToDto),
    verifyRunnerToken: queries.verifyRunnerToken,
    canOpenStream: queries.canOpenStream,
    reconcile,
    runProfileTest,
  };
  let timer: ReturnType<typeof setInterval> | undefined;
  return {
    api,
    http: [environmentRoutes(api, deps.isAdmin)],
    workers: [rebuildWorker(deps.db, recoveryDeps), nativeExecutionWorker(deps.db, executionDeps), { start: () => { timer ??= setInterval(() => void reconcile().catch((e: unknown) => useCaseDeps.logger.error('reconcile failed', { error: String(e) })), 15000); }, stop: async () => { if (timer) clearInterval(timer); timer = undefined; } }],
    migrations: taskRuntimeMigrations,
  };
}
