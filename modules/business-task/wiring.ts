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
import { traceTaskQueries } from './application/traceTasks';
import { serviceRoutes } from './http/serviceRoutes';
import { userRoutes } from './http/userRoutes';
import type { ComputeCatalog, BusinessTaskSettings, Environments, ProjectAuthorizer, Runner, ServiceDirectory } from './ports/runtime';
import type { BusinessExecutionSourceResolver } from './ports/executionSource';
import { drizzleExecutionControls } from './adapters/persistence/executionControl';
import { drizzleExecutionOperations } from './adapters/persistence/executionOperations';
import { executionControlUseCases } from './application/execution/control';
import { executionTaskUseCases } from './application/execution/tasks';
import { executionRoutes } from './http/executionRoutes';
import { executionWorker } from './workers/executionWorker';
import { executionFileUseCases } from './application/execution/files';
import { drizzleLegacyMutations } from './adapters/persistence/legacyMutations';
import { legacyRuntimePorts, legacyWriteApi } from './application/legacyWriteBarrier';

export interface BusinessTaskModuleDeps {
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
  const legacyBarrier = drizzleLegacyMutations(deps.db, deps.settings.legacyOwnerPodUid), legacyDeps = legacyRuntimePorts(useCaseDeps, legacyBarrier);
  const lifecycle = taskLifecycleUseCases(legacyDeps);
  const subtasks = subtaskUseCases(legacyDeps);
  const registerContracts = registerContractsUseCase(useCaseDeps);
  const executionDeps = { ...useCaseDeps, sessions: drizzleExecutionSessions(deps.db), messages: drizzleExecutionMessages(deps.db), agentSecrets: deps.agentSecrets, materials: drizzleExecutionMaterials(deps.db), lifecycles: drizzleExecutionLifecycles(deps.db), runtimeImages: deps.runtimeImages, cancellations: drizzleExecutionCancellations(deps.db), projection: drizzleExecutionProjection(deps.db), subtasks: drizzleExecutionSubtasks(deps.db), cipher: executionCipher(deps.settings.secretKeyBase64), operations: drizzleExecutionOperations(deps.db), controls: drizzleExecutionControls(deps.db), sources: deps.executionSources ?? { resolve: async () => undefined } };
  const tasksV3 = executionTaskUseCases(executionDeps), { progressSubtask, ...subtasksV3 } = executionSubtaskUseCases(executionDeps);
  const { progressProjection, ...projectionV3 } = executionProjectionUseCases(executionDeps);
  const { progressCancellation, ...cancellationV3 } = executionCancellationUseCases(executionDeps);
  const { progressLifecycle, ...lifecycleV3 } = executionLifecycleUseCases(executionDeps);
  const { progressMessage, ...messagesV3 } = executionMessageUseCases(executionDeps);
  const v3 = { ...executionCapabilities(executionDeps), ...messagesV3, ...executionMaterialUseCases(executionDeps), ...lifecycleV3, ...executionRetryUseCases(executionDeps), ...cancellationV3, ...tasksV3, ...subtasksV3, ...projectionV3, ...executionControlUseCases(executionDeps), ...executionFileUseCases(executionDeps), ...executionOperationQueries(executionDeps),
    runOnce: async () => (await tasksV3.runOnce()) + (await progressSubtask()) + (await progressProjection()) + (await progressCancellation()) + (await progressLifecycle()) + (await progressMessage()),
  };
  const api: BusinessTaskModuleApi = {
    ...taskListUseCases(drizzleBusinessTaskList(deps.db)),
    ...legacyRecoveryUseCases(useCaseDeps, legacyBarrier, deps.legacyRecoveryProof),
    imageReferenceState: drizzleImageReferenceState(deps.db),
    v3, releaseHandoff: releaseHandoffUseCases(executionDeps),
    name: 'business-task',
    ...businessClusterUseCases(legacyDeps, drizzleClusterCommands(deps.db)),
    getTask: lifecycle.getTask, listProjectTasks: lifecycle.listProjectTasks,
    ...subtasks,
    ...legacyWriteApi({ ...lifecycle, ...subtasks }, useCaseDeps, legacyBarrier),
    ...traceTaskQueries(useCaseDeps),
    registerContracts,
  };
  const subscriptions = createEventConsumer({ db: deps.db, consumer: deps.settings.consumerName, logger })
    .on(DomainTopic.releaseRegistered, async (e) => { await registerContracts(e.payload); });
  const service = serviceRoutes(api);
  service.route('/', executionRoutes(v3));
  if (deps.identities) service.route('/', legacyServiceRoutes(api, legacyBusinessIdentity(deps.identities)));
  let timer: ReturnType<typeof setInterval> | undefined;
  return {
    api,
    http: { service, user: userRoutes(api, deps.isAdmin) },
    subscriptions,
    workers: [executionWorker(v3.runOnce, logger), { start: () => { timer ??= setInterval(() => void subtasks.sweepActive().catch((e: unknown) => logger.error('subtask sweep failed', { error: String(e) })), 5000); }, stop: async () => { if (timer) clearInterval(timer); timer = undefined; } }],
    migrations: businessTaskMigrations,
  };
}
