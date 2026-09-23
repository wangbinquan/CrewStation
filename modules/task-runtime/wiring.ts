import { join } from 'node:path';
import type { UserId } from '@crewstation/contracts';
import type { AppEnv } from '@crewstation/http';
import type { K8sClient } from '@crewstation/k8s';
import { LABELS } from '@crewstation/k8s';
import type { Clock, Logger } from '@crewstation/kernel';
import { noopLogger, systemClock } from '@crewstation/kernel';
import type { Database, MigrationSet } from '@crewstation/persistence';
import { readMigrationDir, resourceIdentityDirectory } from '@crewstation/persistence';
import { legacyRunnerTaskId } from './adapters/persistence/legacyRunnerTaskId';
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
import { observeStartupUseCase, reconcileUseCase } from './application/reconcile';
import { startupLogTail } from './application/failEnvironment';
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
import type { EnvironmentLedger } from './ports/ledger';
import { resyncLedger } from './application/ledgerResync';
import { ledgerResyncWorker } from './workers/ledgerResyncWorker';
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
  /** RFC-025 资源台账：给了就在每次环境落库时投影期望与领域条件，并定期补投影。 */
  ledger?: EnvironmentLedger;
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
    uow: drizzleUnitOfWork(deps.db, deps.ledger ? { ledger: deps.ledger, ...(deps.logger ? { logger: deps.logger } : {}) } : undefined),
    cluster: deps.cluster ?? kubernetesTaskCluster(deps.k8s, deps.settings.workerUid),
    authorizer: deps.authorizer,
    quotas: deps.quotas,
    profiles: deps.profiles,
    services: deps.services,
    sources: deps.sources,
    legacyRunnerTaskId: legacyRunnerTaskId(resourceIdentityDirectory(deps.db, () => [taskRuntimeMigrations])),
    ...(deps.checkout ? { checkout: deps.checkout } : {}),
    settings: deps.settings,
    clock: deps.clock ?? systemClock,
    logger: deps.logger ?? noopLogger,
  };
  const create = createEnvironmentUseCase(useCaseDeps);
  const lifecycle = lifecycleUseCases(useCaseDeps);
  const queries = environmentQueries(useCaseDeps);
  const reconcile = reconcileUseCase(useCaseDeps, lifecycle);
  const observeStartup = observeStartupUseCase(useCaseDeps, lifecycle);
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
    runningTaskCount: (projectId) => useCaseDeps.uow.read.quota.running(projectId),
    traceKeys: (projectId, page) => useCaseDeps.uow.read.environments.traceKeys(projectId, page),
    activeTraceIds: (projectId, since) => useCaseDeps.uow.read.environments.activeTraceIds(projectId, since),
    listTraceEnvironments: async (projectId, traceIds) => (await useCaseDeps.uow.read.environments.listByProjectTraces(projectId, traceIds)).map((env) => ({ ...environmentToDto(env), updatedAt: env.updatedAt.toISOString() })),
    verifyRunnerToken: queries.verifyRunnerToken,
    canOpenStream: queries.canOpenStream,
    reconcile,
    observeStartup,
    captureStartupLog: async (taskId) => {
      const env = await useCaseDeps.uow.read.environments.getById(taskId);
      return env ? startupLogTail(useCaseDeps, env, env.podName) : undefined;
    },
    runProfileTest,
  };
  const ledger = deps.ledger;
  return {
    api,
    http: [environmentRoutes(api, deps.isAdmin)],
    workers: [rebuildWorker(deps.db, recoveryDeps), nativeExecutionWorker(deps.db, executionDeps), ...periodicWorkers(useCaseDeps.logger, reconcile, observeStartup),
      ...(ledger ? [ledgerResyncWorker(() => resyncLedger(useCaseDeps.uow, ledger, useCaseDeps.logger, useCaseDeps.clock), useCaseDeps.logger)] : [])],
    migrations: taskRuntimeMigrations,
  };
}

/** 对账每 15 秒一轮；启动观测每秒一轮（RFC-022），上一轮没跑完就跳过这一轮，不叠加。 */
function periodicWorkers(logger: Logger, reconcile: () => Promise<unknown>, observeStartup: () => Promise<unknown>) {
  let timer: ReturnType<typeof setInterval> | undefined;
  let observer: ReturnType<typeof setInterval> | undefined, observing = false;
  const observeTick = () => {
    if (observing) return;
    observing = true;
    void observeStartup().catch((e: unknown) => logger.error('startup observation failed', { error: String(e) })).finally(() => { observing = false; });
  };
  return [
    { start: () => { timer ??= setInterval(() => void reconcile().catch((e: unknown) => logger.error('reconcile failed', { error: String(e) })), 15000); }, stop: async () => { if (timer) clearInterval(timer); timer = undefined; } },
    { start: () => { observer ??= setInterval(observeTick, 1000); }, stop: async () => { if (observer) clearInterval(observer); observer = undefined; } },
  ];
}
