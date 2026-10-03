import type { ServiceId } from '@crewstation/contracts';
import { completeFinalizationPorts } from './application/storage/storageCapabilities';
import type { ExecutionObservationAdmission } from './ports/executionSubtasks';
import type { StorageControlSink } from './ports/storage/control';
import type { TaskInputPreparation } from './ports/storage/taskInputs';
import { finalizationRevisions, archiveRevisionIntake } from './application/finalization/revisions';
import { storageOperator } from './application/finalization/operator';
import { storageLossOperator } from './application/finalization/loss';
import { finalizationIntake } from './application/finalization/intake';
import { finalizationRoutes } from './http/finalizationRoutes';
import { finalizationOperations } from './adapters/persistence/finalization/repository';
import { finalizationCompletion } from './adapters/persistence/finalization/completion';
import { prepareFinalizations } from './application/finalization/preparation';
import { archiveFinalizations } from './application/finalization/archiving';
import { cleanupFinalizations } from './application/finalization/cleanup';
import type { FinalizationPreparation } from './ports/storage/preparation';
import { taskStorageQueries, projectTaskStorageList } from './application/finalization/queries';
import { storageControlOutbox } from './adapters/persistence/control-projection/repository';
import { storageSynchronizedControls } from './application/storageControl';
import { drizzleTaskRecoveryRequests } from './adapters/persistence/recovery/repository';
import { recoveryQueries } from './adapters/persistence/recovery/queries';
import { recoveryAdminUseCases } from './application/recovery/admin';
import { recoveryIntakeUseCases } from './application/recovery/intake';
import { recoveryIntakeRoutes } from './http/recoveryIntakeRoutes';
import { drizzleBusinessTaskList } from './adapters/persistence/task-list/repository';
import { taskListUseCases } from './application/taskList';
import type { ExecutionAgentSecrets } from './ports/executionAgentSecrets';
import { legacyRecoveryUseCases } from './application/legacyRecovery';
import type { LegacyRecoveryProof } from './ports/legacyRecovery';
import { drizzleImageReferenceState } from './adapters/persistence/execution/imageReferenceState';
import { releaseHandoffUseCases } from './application/releaseHandoff';
import { executionCapabilities } from './application/execution/capabilities';
import { drizzleExecutionSessions } from './adapters/persistence/sessions/repository';
import { executionOperationQueries } from './application/execution/operationQueries';
import { executionMessageUseCases } from './application/execution/messages';
import { drizzleExecutionMessages } from './adapters/persistence/messages/repository';
import { drizzleExecutionMaterials } from './adapters/persistence/materials/repository';
import { executionMaterialUseCases } from './application/execution/materials';
import { drizzleExecutionLifecycles } from './adapters/persistence/execution/lifecycles';
import { executionLifecycleUseCases } from './application/execution/lifecycle';
import type { BusinessRuntimeImages } from './ports/runtimeImages';
import { executionRetryUseCases } from './application/execution/retry';
import { drizzleExecutionCancellations } from './adapters/persistence/execution/cancellations';
import { executionCancellationUseCases } from './application/execution/cancellation';
import { drizzleExecutionProjection } from './adapters/persistence/execution/projection';
import { executionProjectionUseCases } from './application/execution/projection';
import { drizzleExecutionSubtasks } from './adapters/persistence/execution/subtasks';
import { executionCipher } from './adapters/crypto/executionCipher';
import { executionSubtaskUseCases } from './application/execution/subtasks';
import { legacyBusinessIdentity } from './adapters/persistence/legacyBusinessIdentity';
import { legacyServiceRoutes } from './http/legacyServiceRoutes';
import type { ResourceIdentityDirectory } from '@crewstation/persistence';
import { drizzleClusterCommands } from './adapters/persistence/clusterCommands';
import { businessClusterUseCases } from './application/clusterManagement';
import { join } from 'node:path';
import type { UserId } from '@crewstation/contracts';
import { DomainTopic } from '@crewstation/contracts';
import type { EventConsumer } from '@crewstation/eventbus';
import { createEventConsumer } from '@crewstation/eventbus';
import type { AppEnv } from '@crewstation/http';
import type { Clock, Logger } from '@crewstation/kernel';
import { noopLogger, precondition, systemClock } from '@crewstation/kernel';
import type { Database, MigrationSet } from '@crewstation/persistence';
import { readMigrationDir } from '@crewstation/persistence';
import type { Hono } from 'hono';
import { drizzleUnitOfWork } from './adapters/persistence/drizzleUnitOfWork';
import type { BusinessTaskModuleApi } from './api/moduleApi';
import type { BusinessTaskUseCaseDeps } from './application/dependencies';
import { registerContractsUseCase } from './application/registerContracts';
import { subtaskUseCases } from './application/subtasks';
import { taskLifecycleUseCases } from './application/taskLifecycle';
import { traceTaskQueries } from './application/traceTasks';
import { serviceRoutes } from './http/serviceRoutes';
import { userRoutes } from './http/userRoutes';
import type { ComputeCatalog, BusinessTaskSettings, Environments, ProjectAuthorizer, Runner, ServiceDirectory } from './ports/runtime';
import type { BusinessExecutionSourceResolver } from './ports/executionSource';
import { drizzleExecutionControls } from './adapters/persistence/executionControl';
import { drizzleExecutionOperations } from './adapters/persistence/executionOperations';
import { executionControlUseCases } from './application/execution/control';
import { executionTaskUseCases } from './application/execution/tasks';
import { restartExecutionUseCase } from './application/recovery/restartExecution';
import { executionRoutes } from './http/executionRoutes';
import { executionWorker } from './workers/executionWorker';
import { executionFileUseCases } from './application/execution/files';
import { drizzleLegacyMutations } from './adapters/persistence/legacyMutations';
import { legacyRuntimePorts, legacyWriteApi } from './application/legacyWriteBarrier';
import { businessProjectWork } from './adapters/persistence/deletion/projectWork';
import type { BusinessProjectWork, BusinessWorkSources } from './ports/deletion/work';
import { scopedLegacyPorts } from './application/execution/deletion/legacyWork';
import { scopedFinalizationPorts } from './application/execution/deletion/finalizationWork';
import { guardedBusinessPort, scopedBusinessPorts } from './application/execution/deletion/projectWork';
import { scopedBusinessServiceApi } from './application/execution/deletion/serviceApi';
import { businessDeletionOwner } from './application/execution/deletion/owner';
import { businessDeletionRepository } from './adapters/persistence/deletion/repository';
import { scopedBusinessOperatorApi } from './application/execution/deletion/operatorApi';
import { scopedBusinessHandoff } from './application/execution/deletion/handoffApi';

export interface BusinessTaskModuleDeps {
  deletionWorkSources?: BusinessWorkSources;
  taskInputs?: TaskInputPreparation;
  taskStorageStatus?: (serviceId: ServiceId) => Promise<{ available: boolean; reason: string | null }>;
  finalizationPreparation?: FinalizationPreparation;
  executionObservations?: ExecutionObservationAdmission;
  storageControl?: StorageControlSink;
  legacyRecoveryProof?: LegacyRecoveryProof;
  agentSecrets?: ExecutionAgentSecrets;
  runtimeImages?: BusinessRuntimeImages;
  executionSources?: BusinessExecutionSourceResolver;
  identities?: ResourceIdentityDirectory;
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
  readonly projectWork?: BusinessProjectWork;
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
  const unavailable = async (): Promise<never> => { throw precondition('业务清理的原来源或进程观察器尚未装配'); };
  const deletionSources: BusinessWorkSources = deps.deletionWorkSources ?? { resolve: async () => undefined, assertAvailable: unavailable, assertGrant: unavailable,
    processes: { protectCurrent: unavailable, sweep: unavailable } };
  const deletionOwner = businessDeletionOwner(businessDeletionRepository(deps.db, deletionSources), deletionSources);
  const useCaseDeps: BusinessTaskUseCaseDeps & { projectWork?: BusinessProjectWork } = {
    ...(deps.deletionWorkSources ? { projectWork: businessProjectWork(deps.db, deps.deletionWorkSources) } : {}),
    uow: drizzleUnitOfWork(deps.db), environments: deps.environments, runner: deps.runner, directory: deps.directory, authorizer: deps.authorizer,
    compute: deps.compute, settings: deps.settings, clock: deps.clock ?? systemClock, logger,
  };
  const finalizationPorts = scopedFinalizationPorts(deps.finalizationPreparation, useCaseDeps.projectWork);
  const scopedRunner = useCaseDeps.projectWork ? guardedBusinessPort(deps.runner, useCaseDeps.projectWork, true, ['getExecutionCompletionProof']) : deps.runner;
  const legacyBarrier = drizzleLegacyMutations(deps.db, deps.settings.legacyOwnerPodUid), legacyDeps = legacyRuntimePorts(scopedLegacyPorts(useCaseDeps), legacyBarrier);
  const lifecycle = taskLifecycleUseCases(legacyDeps);
  const subtasks = subtaskUseCases(legacyDeps);
  const registerContracts = registerContractsUseCase(useCaseDeps);
  const recoveryRequests = drizzleTaskRecoveryRequests(deps.db);
  const finalizations = finalizationOperations(deps.db);
  const prepareStorage = finalizationPorts ? prepareFinalizations(finalizations, finalizationCompletion(deps.db), finalizationPorts, scopedRunner, useCaseDeps.projectWork) : async () => 0;
  const archiveStorage = finalizationPorts ? archiveFinalizations(finalizations, finalizationPorts.archive, finalizationPorts.runtime, useCaseDeps.projectWork) : async () => 0;
  const reviseStorage = finalizationPorts ? finalizationRevisions(finalizations, finalizationPorts, useCaseDeps.projectWork) : async () => 0;
  const cleanupStorage = finalizationPorts ? cleanupFinalizations(finalizations, finalizationPorts, useCaseDeps.projectWork) : async () => 0;
  const storedControls = drizzleExecutionControls(deps.db, !!deps.storageControl);
  const synchronizedControls = deps.storageControl ? storageSynchronizedControls(storedControls, storageControlOutbox(deps.db), deps.storageControl, logger, useCaseDeps.projectWork) : undefined;
  const executionDeps = scopedBusinessPorts({ ...useCaseDeps, storageStatus: completeFinalizationPorts(finalizationPorts) && deps.runner.getExecutionCompletionProof ? deps.taskStorageStatus : undefined, taskInputs: deps.taskInputs, executionObservations: deps.executionObservations, recoveryRequests, sessions: drizzleExecutionSessions(deps.db), messages: drizzleExecutionMessages(deps.db), agentSecrets: deps.agentSecrets, materials: drizzleExecutionMaterials(deps.db), lifecycles: drizzleExecutionLifecycles(deps.db), runtimeImages: deps.runtimeImages, cancellations: drizzleExecutionCancellations(deps.db), projection: drizzleExecutionProjection(deps.db), subtasks: drizzleExecutionSubtasks(deps.db), cipher: executionCipher(deps.settings.secretKeyBase64), operations: drizzleExecutionOperations(deps.db), controls: synchronizedControls ?? storedControls, sources: deps.executionSources ?? { resolve: async () => undefined } }, true);
  const tasksV3 = executionTaskUseCases(executionDeps), { progressSubtask, ...subtasksV3 } = executionSubtaskUseCases(executionDeps);
  const { progressProjection, ...projectionV3 } = executionProjectionUseCases(executionDeps);
  const { progressCancellation, ...cancellationV3 } = executionCancellationUseCases(executionDeps);
  const { progressLifecycle, ...lifecycleV3 } = executionLifecycleUseCases(executionDeps);
  const { progressMessage, ...messagesV3 } = executionMessageUseCases(executionDeps);
  const rawV3 = { ...executionCapabilities(executionDeps), ...messagesV3, ...executionMaterialUseCases(executionDeps), ...lifecycleV3, ...executionRetryUseCases(executionDeps), ...cancellationV3, ...tasksV3, ...subtasksV3, ...projectionV3, ...executionControlUseCases(executionDeps), ...executionFileUseCases(executionDeps), ...executionOperationQueries(executionDeps),
    ...recoveryIntakeUseCases(executionDeps), ...restartExecutionUseCase(executionDeps), ...finalizationIntake(executionDeps, finalizations, finalizationPorts), ...archiveRevisionIntake(executionDeps, finalizations, finalizationPorts),
    runOnce: async () => (await synchronizedControls?.syncPending() ?? 0) + (await tasksV3.runOnce()) + (await progressSubtask()) + (await progressProjection()) + (await progressCancellation()) + (await progressLifecycle()) + (await progressMessage()) + (await recoveryRequests.reconcile()) + (await prepareStorage()) + (await archiveStorage()) + (await cleanupStorage()) + (await reviseStorage()),
  };
  const v3 = scopedBusinessServiceApi(rawV3, executionDeps);
  const operatorQueries = recoveryQueries(deps.db);
  const operatorApi = scopedBusinessOperatorApi({ ...storageOperator(executionDeps, operatorQueries, finalizations, finalizationPorts),
    ...storageLossOperator(deps.authorizer, operatorQueries, finalizations, finalizationPorts), ...recoveryAdminUseCases(executionDeps, operatorQueries) }, executionDeps, operatorQueries);
  const api: BusinessTaskModuleApi = {
    deletionOwner,
    ...operatorApi,
    ...taskStorageQueries(recoveryQueries(deps.db), finalizations, deps.authorizer),
    ...projectTaskStorageList(drizzleBusinessTaskList(deps.db), deps.authorizer),
    acceptedArchiveRevision: async (id) => { const change = await finalizations.revision(id); return change?.state === 'pending' ? change : undefined; },
    acceptedFinalization: async (id) => { const op = await finalizations.get(id); return op ? { id: op.id, projectId: op.projectId, serviceId: op.serviceId, spaceId: op.spaceId, taskId: op.view.taskId, taskGeneration: op.view.taskGeneration, volumeUid: op.volumeUid, outcome: op.view.outcome, archive: op.archive } : undefined; },
    archiveTask: async (serviceId, taskId) => { const op = await executionDeps.operations.forTask(serviceId, taskId); return op ? { projectId: op.intent.projectId, completionPolicy: op.intent.task.completionPolicy ?? 'legacy' } : undefined; },
    ...taskListUseCases(drizzleBusinessTaskList(deps.db)),
    ...legacyRecoveryUseCases(scopedLegacyPorts(useCaseDeps), legacyBarrier, deps.legacyRecoveryProof),
    imageReferenceState: drizzleImageReferenceState(deps.db),
    v3, releaseHandoff: scopedBusinessHandoff(releaseHandoffUseCases(executionDeps), useCaseDeps.projectWork),
    name: 'business-task',
    ...businessClusterUseCases(legacyDeps, drizzleClusterCommands(deps.db)),
    listProjectTasks: lifecycle.listProjectTasks,
    ...subtasks,
    ...legacyWriteApi({ ...lifecycle, ...subtasks }, useCaseDeps, legacyBarrier, useCaseDeps.projectWork),
    ...traceTaskQueries(useCaseDeps),
    registerContracts,
  };
  const subscriptions = createEventConsumer({ db: deps.db, consumer: deps.settings.consumerName, logger })
    .on(DomainTopic.releaseRegistered, async (e) => { await registerContracts(e.payload); });
  const service = serviceRoutes(api);
  service.route('/', executionRoutes(v3));
  service.route('/', recoveryIntakeRoutes(v3));
  service.route('/', finalizationRoutes(v3));
  if (deps.identities) service.route('/', legacyServiceRoutes(api, legacyBusinessIdentity(deps.identities)));
  let timer: ReturnType<typeof setInterval> | undefined;
  return {
    projectWork: useCaseDeps.projectWork,
    api,
    http: { service, user: userRoutes(api, deps.isAdmin) },
    subscriptions,
    workers: [executionWorker(v3.runOnce, logger), { start: () => { timer ??= setInterval(() => void subtasks.sweepActive().catch((e: unknown) => logger.error('subtask sweep failed', { error: String(e) })), 5000); }, stop: async () => { if (timer) clearInterval(timer); timer = undefined; } }],
    migrations: businessTaskMigrations,
  };
}

/** Read-only owner source; the composition root supplies its transaction snapshot. */
export { readBusinessObservationFacts } from './adapters/persistence/task-list/repository';

export { readBusinessObservationTaskPage, readBusinessObservationAttemptPage } from './adapters/persistence/task-list/observationPages';
