import { resourceEndingHandler } from './application/development/parent/retention';
import { originalProjectTaskIds } from './adapters/persistence/infrastructure/origins';
import { originalRuntimeWorkInfrastructure } from './adapters/persistence/deletion/workOrigin';
import { runtimeProjectWork } from './adapters/persistence/deletion/projectWork';
import { runtimeDeletionRepository } from './adapters/persistence/deletion/repository';
import { runtimeOriginalJobs } from './adapters/persistence/deletion/originalJobs';
import { runtimeStopUnitOfWork } from './adapters/persistence/deletion/stopUnitOfWork';
import { runtimeDeletionOwner } from './application/deletion/owner';
import { runtimeOriginalStop } from './application/deletion/originalStop';
import type { RuntimeOriginalStopSources } from './ports/deletion/originalStop';
import { scopedRuntimePorts, guardedRuntimePort } from './application/deletion/ports';
import { runtimeWorkApi } from './application/deletion/api';
import { runtimeArchiveWork, runtimeStorageWork } from './application/deletion/storage';
import type { RuntimeProjectWork, RuntimeWorkSources } from './ports/deletion/work';
import { developmentRemovalLookup } from './application/development/removalLookup';
import { developmentCleanupSelection } from './domain/development/cleanupSelection';
import type { DevelopmentCleanupParticipant } from './ports/developmentCleanup';
import { developmentUsageLayoutLookup } from './application/development/layoutLookup';
import { inspectBusinessRecovery } from './application/business/recoveryInspection';
import { businessStorageFinalization } from './application/business/finalization';
import { businessStorageCleanup } from './application/business/storageCleanup';
import { unprovisionedStorage } from './adapters/persistence/unprovisionedStorage';
import type { ArchiveCredentials } from './ports/archiveExecution';
import { archiveExecutionStore } from './adapters/persistence/archiveExecutions';
import { archiveExecution } from './application/archive/execution';
import { archiveExecutionWorker } from './workers/archiveExecutions';
import { rebuildBusinessWorkspace } from './application/business/rebuild';
import { restartBusinessWorkspace } from './application/business/restart';
import { environmentImageHistory } from './adapters/persistence/imageHistory';
import { blockBusinessAdmission } from './application/business/blockAdmission';
import type { LeasePort } from '@crewstation/resource-runtime';
import { runImageProbe } from './application/imageProbe/run';
import { stopImageProbe } from './application/imageProbe/stop';
import { imageProbeCleanup } from './adapters/k8s/imageProbe';
import { join } from 'node:path';
import type { TaskId, UserId } from '@crewstation/contracts';
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
import { runtimeImageReferenceState } from './application/runtime-images/referenceState';
import { observeStartupUseCase, reconcileUseCase } from './application/reconcile';
import { startupLogTail } from './application/failEnvironment';
import { reconcileRebuildUseCase } from './application/reconcileRebuild';
import { rebuildUseCases } from './application/requestRebuild';
import { rebuildWorker } from './workers/rebuildWorker';
import { nativeExecutionWorker } from './workers/nativeExecutionWorker';
import { developmentParentEndingWorker } from './workers/developmentParentEndingWorker';
import { developmentParentRecoveryWorker } from './workers/developmentParentRecoveryWorker';
import { kubernetesDevelopmentParentPhysical } from './adapters/k8s/parentEnding/physical';
import type { TaskDevelopmentRemovalQuery } from './adapters/k8s/taskRemovalGuard';
import type { DevelopmentParentPhysical } from './ports/developmentParentPhysical';
import { createNativeExecutionUseCase } from './application/nativeExecution';
import { resolveDevelopmentObjectSource } from './application/development/objectStorage';
import { createTestEnvironmentUseCase } from './application/testEnvironment';
import { workloadRenderUseCases } from './application/workloadRender';
import { PROFILE_TEST_LABELS } from './domain/profileTestEnvironment';
import { runProfileTestUseCase } from './application/profileTest';
import type { ProfileTestTiming } from './application/profileTest';
import { environmentRoutes } from './http/environmentRoutes';
import type { TaskCluster } from './ports/cluster';
import type { EnvironmentLedger } from './ports/ledger';
import type { WorkloadSafetyPort, TaskVolumePort } from './ports/workloadSafety';
import { resyncLedger } from './application/ledgerResync';
import { ledgerResyncWorker } from './workers/ledgerResyncWorker';
import { runtimeLifecycleWorkers } from './workers/runtimeLifecycle';
import type { EnvironmentSources, ProfileCatalog, ProjectAuthorizer, QuotaSource, ServiceResolver, SourceCheckoutSource, TaskRuntimeSettings, TestRunner } from './ports/platform';

export interface TaskRuntimeModuleDeps {
  deletionWorkSources?: RuntimeWorkSources;
  deletionStops?: RuntimeOriginalStopSources;
  developmentParentPhysical?: DevelopmentParentPhysical;
  developmentCleanup?: DevelopmentCleanupParticipant;
  archive?: { credentials: ArchiveCredentials; apiUrl: string };
  workloadSafety?: WorkloadSafetyPort;
  taskVolumes?: TaskVolumePort;
  imageProbeLeases?: { port: LeasePort; holder: string };
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
  /** RFC-025 I25：工作区的容器由资源中心照记录建出（要配台账）；不给就由本模块自己建。 */
  creation?: 'ledger';
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

function ledgerProjectionFor(deps: TaskRuntimeModuleDeps): Parameters<typeof drizzleUnitOfWork>[1] {
  return deps.ledger ? { ledger: deps.ledger, ...(deps.logger ? { logger: deps.logger } : {}),
    ...(deps.creation === 'ledger' ? { preview: async (env) => {
      if (!env.preview || env.native) return undefined;
      let route = env.render?.previewRoute;
      if (!route) {
        const service = await deps.services.resolveServiceById(env.serviceId);
        if (!service) throw new Error('预览所属服务不存在，暂不移交入口');
        route = { host: `dev.${service.slug}.${deps.settings.userDomain}`, middlewares: [{ name: deps.settings.dropIdentityHeadersMiddleware, namespace: deps.settings.systemNamespace }, { name: deps.settings.userAuthMiddleware, namespace: deps.settings.systemNamespace }] };
      }
      return { ...route, middlewares: [...route.middlewares, ...(deps.settings.previewRateMiddlewares ?? []).map((name) => ({ name }))] };
    } } : {}) } : undefined;
}

function taskRuntimeUseCaseDeps(deps: TaskRuntimeModuleDeps, developmentRemoval: TaskDevelopmentRemovalQuery): TaskRuntimeUseCaseDeps {
  return {
    developmentCleanup: deps.developmentCleanup, workloadSafety: deps.workloadSafety, taskVolumes: deps.taskVolumes,
    ...(deps.ledger && deps.creation === 'ledger' ? { unprovisionedStorage: unprovisionedStorage(deps.db, deps.ledger) } : {}),
    uow: drizzleUnitOfWork(deps.db, ledgerProjectionFor(deps)),
    cluster: deps.cluster ?? kubernetesTaskCluster(deps.k8s, deps.settings.workerUid, developmentRemoval),
    businessStorageInspector: kubernetesTaskRecoveryCluster(deps.k8s, developmentRemoval),
    developmentParentInspector: kubernetesTaskRecoveryCluster(deps.k8s, developmentRemoval),
    authorizer: deps.authorizer,
    quotas: deps.quotas,
    profiles: deps.profiles,
    services: deps.services,
    sources: deps.sources,
    ...(deps.testRunner ? { initializationRunner: deps.testRunner } : {}),
    legacyRunnerTaskId: legacyRunnerTaskId(resourceIdentityDirectory(deps.db, () => [taskRuntimeMigrations])),
    ...(deps.checkout ? { checkout: deps.checkout } : {}),
    settings: deps.settings,
    ...(deps.ledger && deps.creation ? { creation: deps.creation } : {}),
    clock: deps.clock ?? systemClock,
    logger: deps.logger ?? noopLogger,
  };
}

function taskRuntimeParticipants(deps: TaskRuntimeModuleDeps) {
  const forward: TaskDevelopmentRemovalQuery = (target) => query ? query(target) : Promise.resolve({ kind: 'waiting', reason: '原开发删除来源尚未装配' });
  const work = deps.deletionWorkSources ? runtimeProjectWork(deps.db, deps.deletionWorkSources,
    (error) => (deps.logger ?? noopLogger).warn('runtime original lifetime pending', { error: String(error) })) : undefined;
  const raw = taskRuntimeUseCaseDeps(deps, forward);
  raw.developmentParentPhysical = deps.developmentParentPhysical ?? kubernetesDevelopmentParentPhysical(deps.k8s, forward);
  const useCaseDeps = work ? scopedRuntimePorts(raw, work) : raw;
  const nativeCluster = kubernetesNativeExecutions(deps.k8s, deps.settings.workerUid, deps.workloadSafety);
  const executionDeps = { ...useCaseDeps, nativeCluster: work ? guardedRuntimePort(nativeCluster, work) : nativeCluster };
  const stopping = work && deps.deletionWorkSources && deps.deletionStops ? runtimeOriginalStop({
    ...scopedRuntimePorts({ ...raw, uow: runtimeStopUnitOfWork(deps.db), cluster: { ...raw.cluster,
      deleteVolume: async () => { throw new Error('项目停止阶段禁止提前回收工作卷'); } }, }, work),
    nativeCluster: guardedRuntimePort(nativeCluster, work),
  }, work, guardedRuntimePort(runtimeOriginalJobs(deps.db, deps.deletionWorkSources), work), {
    ...guardedRuntimePort({ digital: deps.deletionStops.digital, stopped: deps.deletionStops.stopped }, work),
    development: (context) => guardedRuntimePort(deps.deletionStops!.development(context), work),
  }) : undefined;
  const query = developmentRemovalLookup(executionDeps);
  const recoveryCluster = kubernetesTaskRecoveryCluster(deps.k8s, forward), provisioner = kubernetesRebuildProvisioner(deps.k8s, deps.settings.workerUid, forward);
  const recoveryDeps = { ...useCaseDeps, recoveryCluster: work ? guardedRuntimePort(recoveryCluster, work) : recoveryCluster, provisioner: work ? guardedRuntimePort(provisioner, work) : provisioner };
  return { useCaseDeps, executionDeps, recoveryDeps, work, stopping };
}

export function createTaskRuntimeModule(deps: TaskRuntimeModuleDeps): TaskRuntimeModule {
  const { useCaseDeps, executionDeps, recoveryDeps, work, stopping } = taskRuntimeParticipants(deps);
  const create = createEnvironmentUseCase(useCaseDeps);
  const { archiveStore, archives } = runtimeArchives(deps, useCaseDeps, work);
  const testRunner = deps.testRunner && (work ? guardedRuntimePort(deps.testRunner, work) : deps.testRunner);
  const lifecycle = lifecycleUseCases(useCaseDeps);
  const queries = environmentQueries(useCaseDeps);
  const reconcile = reconcileUseCase(useCaseDeps, lifecycle);
  const observeStartup = observeStartupUseCase(useCaseDeps, lifecycle);
  const createNative = createNativeExecutionUseCase(executionDeps);
  const rebuild = rebuildUseCases(recoveryDeps);
  const createTestEnvironment = createTestEnvironmentUseCase(useCaseDeps);
  const runProfileTest = runProfileTestUseCase(useCaseDeps, {
    createTestEnvironment: (input) => createTestEnvironment({ ...input, labels: { [LABELS.project]: PROFILE_TEST_LABELS.project, [LABELS.service]: PROFILE_TEST_LABELS.service, ...input.labels } }),
    release: (taskId) => lifecycle.releaseEnvironment(taskId, 'profile-test'),
    ...(testRunner ? { runner: testRunner } : {}), ...(deps.testTiming ? { timing: deps.testTiming } : {}), ...(deps.testMcp ? { mcp: deps.testMcp } : {}),
  });
  const api: TaskRuntimeModuleApi = {
    ...(stopping && deps.deletionWorkSources ? { deletionOwner: runtimeDeletionOwner(runtimeDeletionRepository(deps.db, deps.deletionWorkSources), deps.deletionWorkSources, stopping) } : {}),
    ...(archives ? { archiveExecution: archives } : {}),
    ...(archives && deps.taskVolumes ? { storageCleanup: businessStorageCleanup(useCaseDeps, archives) } : {}),
    ...businessStorageFinalization(useCaseDeps),
    ...businessRecoveryApi(useCaseDeps),
    name: 'task-runtime',
    originalInfrastructureOwnership: (kind, key, representation) => originalRuntimeWorkInfrastructure(deps.db, kind, key, representation),
    originalProjectTaskIds: (projectId, after) => originalProjectTaskIds(deps.db, projectId, after),
    inspectResourceEnding: resourceEndingHandler(useCaseDeps, ledgerProjectionFor(deps)?.preview),
    imageHistory: environmentImageHistory(deps.db),
    blockBusinessAdmission: blockBusinessAdmission(useCaseDeps),
    imageReferenceState: runtimeImageReferenceState(useCaseDeps),
    runRuntimeImageProbe: runImageProbe(useCaseDeps, { create: createTestEnvironment, runner: testRunner, mcp: deps.testMcp }),
    stopRuntimeImageProbe: stopImageProbe(useCaseDeps, deps.imageProbeLeases ? imageProbeCleanup(deps.k8s, deps.imageProbeLeases.port, deps.imageProbeLeases.holder) : undefined),
    reconcileRebuild: reconcileRebuildUseCase(recoveryDeps),
    listClusterTasks: queries.listClusterTasks,
    lookupDevelopmentUsageLayout: developmentUsageLayoutLookup(useCaseDeps),
    inspectDevelopmentRemoval: developmentRemovalLookup(executionDeps),
    inspectDevelopmentCleanupSelection: async (taskId) => { const env = await useCaseDeps.uow.read.environments.getById(taskId); return env ? developmentCleanupSelection(env) : undefined; },
    resourceWorkloads: queries.resourceWorkloads,
    resourceWorkload: queries.resourceWorkload,
    ...rebuild,
    createEnvironment: async (input) => environmentToDto(await create(input)),
    resolveDevelopmentObjectSource: resolveDevelopmentObjectSource(useCaseDeps),
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
    captureStartupLog: (taskId) => captureStartupLog(useCaseDeps, taskId),
    runProfileTest,
    ...workloadRenderUseCases(useCaseDeps),
  };
  const ledger = deps.ledger;
  const guardedApi = scopedRuntimeApi(api, work, archiveStore);
  return {
    api: guardedApi,
    http: [environmentRoutes(guardedApi, deps.isAdmin)],
    workers: [rebuildWorker(deps.db, recoveryDeps), nativeExecutionWorker(deps.db, executionDeps), ...runtimeLifecycleWorkers(useCaseDeps.logger, reconcile, observeStartup), ...(archives ? [archiveExecutionWorker(archives.reconcile, useCaseDeps.logger)] : []),
      developmentParentEndingWorker(deps.db, useCaseDeps), developmentParentRecoveryWorker(useCaseDeps),
      ...(ledger ? [ledgerResyncWorker(() => resyncLedger(useCaseDeps.uow, ledger, useCaseDeps.logger, useCaseDeps.clock, work), useCaseDeps.logger)] : []),
      ...(work ? [{ start: () => {}, stop: work.drain }] : [])],
    migrations: taskRuntimeMigrations,
  };
}
function runtimeArchives(deps: TaskRuntimeModuleDeps, runtime: TaskRuntimeUseCaseDeps, work?: RuntimeProjectWork) {
  const archiveStore = deps.archive && deps.ledger && deps.creation === 'ledger' ? archiveExecutionStore(deps.db, deps.ledger) : undefined;
  const archives = deps.archive && archiveStore ? archiveExecution({ runtime, store: work ? guardedRuntimePort(archiveStore, work) : archiveStore,
    apiUrl: deps.archive.apiUrl, credentials: work ? guardedRuntimePort(deps.archive.credentials, work) : deps.archive.credentials }) : undefined;
  return { archiveStore, archives };
}
function scopedRuntimeApi(api: TaskRuntimeModuleApi, work: RuntimeProjectWork | undefined, archiveStore: ReturnType<typeof archiveExecutionStore> | undefined) {
  return work ? runtimeWorkApi({ ...api,
    ...(api.archiveExecution && archiveStore ? { archiveExecution: runtimeArchiveWork(api.archiveExecution, archiveStore, work) } : {}),
    ...(api.storageCleanup ? { storageCleanup: runtimeStorageWork(api.storageCleanup, work) } : {}),
  }, work) : api;
}

function businessRecoveryApi(deps: TaskRuntimeUseCaseDeps): Pick<TaskRuntimeModuleApi, 'inspectBusinessRecovery' | 'rebuildBusinessWorkspace' | 'restartBusinessWorkspace'> {
  const rebuild = rebuildBusinessWorkspace(deps), restart = restartBusinessWorkspace(deps);
  return { inspectBusinessRecovery: inspectBusinessRecovery(deps), rebuildBusinessWorkspace: async (input) => environmentToDto(await rebuild(input)), restartBusinessWorkspace: async (input) => environmentToDto(await restart(input)) };
}

async function captureStartupLog(deps: TaskRuntimeUseCaseDeps, taskId: TaskId) {
  const env = await deps.uow.read.environments.getById(taskId);
  return env ? startupLogTail(deps, env, env.podName) : undefined;
}
