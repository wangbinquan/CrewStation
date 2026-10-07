import { developmentObservationProducer } from './application/development/observationProducer';
import type { DevelopmentDispatchSession } from './ports/developmentDispatch';
import type { DevelopmentCleanupSession } from './ports/developmentCleanup';
import { developmentCleanupParticipant } from './application/development/cleanup';
import { developmentEndingStore } from './adapters/persistence/ending/store';
import type { DevelopmentRuntimeImages } from './ports/runtimeImages';
import type { DevelopmentUsagePricing } from './ports/developmentUsage';
import { developmentUsageOwnerStore } from './adapters/persistence/developmentUsage';
import { developmentUsageOwner } from './application/developmentUsage';
import { join } from 'node:path';
import type { ProjectDeletionContext, TaskId, UserId } from '@crewstation/contracts';
import { TaskIdSchema } from '@crewstation/contracts';
import type { AppEnv } from '@crewstation/http';
import type { Clock, Logger } from '@crewstation/kernel';
import { isPlatformError, jsonHash, newResourceId, noopLogger, precondition, systemClock } from '@crewstation/kernel';
import type { Database, MigrationSet, ResourceIdentityDirectory } from '@crewstation/persistence';
import { readMigrationDir } from '@crewstation/persistence';
import type { Hono } from 'hono';
import { yamlManifestParser } from './adapters/manifest/yamlManifestParser';
import { drizzleComparisonReferences } from './adapters/persistence/drizzleComparisonReferences';
import { drizzleReminderRepository } from './adapters/persistence/drizzleReminderRepository';
import { drizzleNativeTerminals } from './adapters/persistence/drizzleNativeTerminals';
import { drizzleWorkspaceLayouts } from './adapters/persistence/drizzleWorkspaceLayouts';
import { drizzleNativeActivity } from './adapters/persistence/drizzleNativeActivity';
import { drizzleAgentStarts } from './adapters/persistence/drizzleAgentStarts';
import { AgentExecutionLifecycle } from './application/agentExecution';
import { boundedNativeRead, nativeActivityUseCases, rosterActivity } from './application/nativeActivity';
import { workspaceLayoutUseCases } from './application/workspaceLayout';
import { workspaceLayoutRoutes } from './http/workspaceLayoutRoutes';
import type { DevSessionModuleApi } from './api/moduleApi';
import { agentUseCases, clusterAgentUseCases } from './application/agents';
import { nativeTerminalUseCases, clusterNativeUseCases } from './application/nativeTerminals';
import type { DevSessionUseCaseDeps } from './application/dependencies';
import { idleReminderUseCase } from './application/idleReminder';
import { publishFromSessionUseCase } from './application/publishFromSession';
import { previewControlUseCases } from './application/previewControl';
import { rebuildSessionUseCases, sessionLifecycleUseCases } from './application/sessionLifecycle';
import { workspaceStatusUseCase } from './application/workspaceStatus';
import { versionComparisonUseCases } from './application/versionComparison';
import { apiInvocationUseCase } from './application/apiInvocation';
import { devSessionRoutes } from './http/devSessionRoutes';
import { nativeTerminalRoutes } from './http/nativeTerminalRoutes';
import type { ApiInvocationCatalog, ComputeCatalog, DevSessionSettings, McpCredentials, Notifier, ProjectAuthorizer, Releases, ServiceResolver, SourceControl } from './ports/platform';
import type { Environments, Runner } from './ports/runtime';
import type { ExecutionRecords } from './ports/executionRecords';
import { withExecutionPhase } from './domain/terminalPhase';
import type { DevelopmentProjectWork, DevelopmentWorkSources } from './ports/deletion/work';
import { developmentProjectWork } from './adapters/persistence/deletion/projectWork';
import { developmentDeletionRepository } from './adapters/persistence/deletion/repository';
import { developmentDeletionOwner } from './application/deletion/owner';
import { guardedDevelopmentPort, scopedDevelopmentPorts } from './application/deletion/ports';
import { developmentWorkApi } from './application/deletion/api';
import { developmentCleanupWork, developmentUsageWork } from './application/deletion/internalWork';
import { developmentWorker } from './application/developmentWorker';

export interface DevSessionModuleDeps {
  deletionWorkSources?: DevelopmentWorkSources;
  developmentUsagePricing?: DevelopmentUsagePricing;
  developmentCleanupSession?: DevelopmentCleanupSession;
  developmentDispatchSession?: DevelopmentDispatchSession;
  projectDeletionSession?: (context: ProjectDeletionContext, taskId: TaskId) => Promise<DevelopmentCleanupSession>;
  identities?: ResourceIdentityDirectory;
  /** 资源台账里 CLI／Agent 执行记录的阶段（RFC-025 §11.2）；缺省时名册照 Runner 的说法给出。 */
  runtimeImages?: DevelopmentRuntimeImages;
  executions?: ExecutionRecords;
  apiCatalog: ApiInvocationCatalog;
  /** 算力档位解析（RFC-001），由组合根接到 project。 */
  compute: ComputeCatalog;
  db: Database;
  environments: Environments;
  runner: Runner;
  scm: SourceControl;
  releases: Releases;
  authorizer: ProjectAuthorizer;
  services: ServiceResolver;
  notifier: Notifier;
  credentials: McpCredentials;
  isAdmin: (userId: UserId) => Promise<boolean>;
  settings: DevSessionSettings;
  clock?: Clock;
  logger?: Logger;
}

export interface DevSessionModule {
  readonly api: DevSessionModuleApi;
  readonly http: Hono<AppEnv>[];
  readonly workers: Array<{ start(): void; stop(): Promise<void> }>;
  readonly migrations: MigrationSet;
}

export { readDevelopmentObservationFacts, readDevelopmentObservationTaskPage, readDevelopmentObservationAttemptPage } from './adapters/persistence/developmentObservationFacts';

export const devSessionMigrations: MigrationSet = {
  module: 'dev_session',
  layer: 5,
  files: readMigrationDir(join(import.meta.dir, 'adapters', 'persistence', 'migrations')),
};

export function createDevSessionModule(deps: DevSessionModuleDeps): DevSessionModule {
  const projectWork = deps.deletionWorkSources ? developmentProjectWork(deps.db, deps.deletionWorkSources,
    (error) => (deps.logger ?? noopLogger).error('development original lifetime failed', { error: String(error) })) : undefined;
  const rawDeps: DevSessionUseCaseDeps = {
    executions: deps.executions, runtimeImages: deps.runtimeImages,
    comparisons: drizzleComparisonReferences(deps.db, deps.clock ?? systemClock, deps.identities),
    environments: deps.environments, runner: deps.runner, scm: deps.scm, releases: deps.releases, manifests: yamlManifestParser,
    authorizer: deps.authorizer, apiCatalog: deps.apiCatalog,
    compute: deps.compute, services: deps.services, notifier: deps.notifier, credentials: deps.credentials, reminders: drizzleReminderRepository(deps.db),
    settings: deps.settings, clock: deps.clock ?? systemClock, logger: deps.logger ?? noopLogger,
  };
  const useCaseDeps = projectWork ? scopedDevelopmentPorts(rawDeps, projectWork) : rawDeps;
  const api = developmentApi(deps, useCaseDeps, projectWork);
  const drain = () => projectWork?.drain() ?? Promise.resolve();
  return {
    api,
    http: [devSessionRoutes(api, deps.isAdmin), nativeTerminalRoutes(api, deps.isAdmin), workspaceLayoutRoutes(api, deps.isAdmin)],
    workers: [developmentWorker(api.sendIdleReminders, 60_000, drain, (error) => useCaseDeps.logger.error('idle reminder failed', { error: String(error) })),
      developmentWorker(api.reconcileNativeExecutions, 2000, drain, () => useCaseDeps.logger.error('execution reconciliation failed'))],
    migrations: devSessionMigrations,
  };
}

function developmentApi(deps: DevSessionModuleDeps, useCaseDeps: DevSessionUseCaseDeps, projectWork?: DevelopmentProjectWork): DevSessionModuleApi {
  const lifecycle = sessionLifecycleUseCases(useCaseDeps);
  const rawAgentStarts = drizzleAgentStarts(deps.db, !!projectWork), agentStarts = projectWork ? guardedDevelopmentPort(rawAgentStarts, projectWork) : rawAgentStarts;
  const store = developmentUsageOwnerStore(deps.db), pricing = deps.developmentUsagePricing;
  const rawUsage = developmentUsageOwner(projectWork ? guardedDevelopmentPort(store, projectWork) : store, agentStarts, useCaseDeps.environments,
    pricing && projectWork ? guardedDevelopmentPort(pricing, projectWork) : pricing);
  const developmentUsage = projectWork ? developmentUsageWork(rawUsage, projectWork) : rawUsage;
  const endingStore = developmentEndingStore(deps.db, useCaseDeps.clock);
  const originalEndingStore = projectWork ? guardedDevelopmentPort(endingStore, projectWork) : endingStore;
  const observation = deps.developmentDispatchSession && deps.developmentCleanupSession ? developmentObservationProducer(useCaseDeps, {
    owner: rawUsage, store: originalEndingStore,
    dispatch: projectWork ? guardedDevelopmentPort(deps.developmentDispatchSession, projectWork) : deps.developmentDispatchSession,
    ending: projectWork ? guardedDevelopmentPort(deps.developmentCleanupSession, projectWork) : deps.developmentCleanupSession,
  }) : undefined;
  const agentExecutions = new AgentExecutionLifecycle(useCaseDeps, agentStarts, observation);
  const agents = agentUseCases(useCaseDeps, agentStarts, agentExecutions);
  const remind = idleReminderUseCase(useCaseDeps);
  const rawTerminals = drizzleNativeTerminals(deps.db, !!projectWork), terminals = projectWork ? guardedDevelopmentPort(rawTerminals, projectWork) : rawTerminals;
  const rawActivity = drizzleNativeActivity(deps.db), activity = nativeActivityUseCases(useCaseDeps, projectWork ? guardedDevelopmentPort(rawActivity, projectWork) : rawActivity, terminals);
  const native = nativeTerminalUseCases(useCaseDeps, terminals);
  // 启动中名册每秒读一次（RFC-022），原生活动页不跟着每秒做：同一任务、同一人 5 秒内复用。
  const activityPage = rosterActivity((actor, taskId) => boundedNativeRead(activity.getAgentActivity(actor, taskId, { limit: 1 })).catch((error: unknown) => {
    if (isPlatformError(error) && ['forbidden', 'unauthenticated', 'not_found'].includes(error.kind)) throw error;
    useCaseDeps.logger.warn('native activity query unavailable', { taskId });
    return undefined;
  }), useCaseDeps.clock);
  const makeCleanup = (session: DevelopmentCleanupSession, closing = false) => developmentCleanupParticipant({ owner: rawUsage,
    store: projectWork ? guardedDevelopmentPort(endingStore, projectWork) : endingStore, environments: useCaseDeps.environments,
    session: projectWork ? guardedDevelopmentPort(session, projectWork) : session, clock: useCaseDeps.clock,
    ...(closing ? { closeOriginalAdmission: async (id: TaskId) => { await rawUsage.close(id, 'cancelled'); } } : {}) });
  const cleanup = deps.developmentCleanupSession ? makeCleanup(deps.developmentCleanupSession) : undefined;
  const api: DevSessionModuleApi = {
    ...(deps.deletionWorkSources ? { deletionOwner: developmentDeletionOwner(developmentDeletionRepository(deps.db, deps.deletionWorkSources), deps.deletionWorkSources) } : {}),
    developmentUsage,
    ...(cleanup ? { developmentCleanup: projectWork ? developmentCleanupWork(cleanup, projectWork) : cleanup } : {}),
    ...((cleanup || deps.projectDeletionSession) && projectWork ? { projectDeletionCleanup: (context, input) => {
      if (context.phase !== 'stop') throw precondition('开发项目清理只接受当前停止阶段许可');
      return projectWork.runGranted(context, { originKind: 'task', originKey: input.identity.executionId,
        reference: newResourceId(), inputDigest: jsonHash(input) }, async () => {
        const session = await deps.projectDeletionSession?.(context, TaskIdSchema.parse(input.identity.executionId));
        return (session ? makeCleanup(session, true) : cleanup!).advance(input);
      });
    } } : {}),
    invokeApi: apiInvocationUseCase(useCaseDeps),
    ...clusterAgentUseCases(useCaseDeps, agentStarts, agentExecutions), ...clusterNativeUseCases(useCaseDeps, terminals),
    name: 'dev-session', ...lifecycle, ...agents, ...native, ...activity, ...workspaceLayoutUseCases(useCaseDeps, projectWork ? guardedDevelopmentPort(drizzleWorkspaceLayouts(deps.db), projectWork) : drizzleWorkspaceLayouts(deps.db), terminals),
    // 子 Runner 连上时由组合根调用：headless Agent 的执行环境先认领，其余按「＋ CLI」处理（RFC-006）。
    dispatchPendingNativeExecution: async (executionTaskId) => { if (!(await agentExecutions.dispatchExecution(executionTaskId))) await native.dispatchPendingNativeExecution(executionTaskId); },
    reconcileNativeExecutions: async () => { await Promise.all([native.reconcileNativeExecutions(), agentExecutions.sweep()]); },
    ...rebuildSessionUseCases(useCaseDeps), ...previewControlUseCases(useCaseDeps),
    ...versionComparisonUseCases(useCaseDeps), workspaceStatus: workspaceStatusUseCase(useCaseDeps), publish: publishFromSessionUseCase(useCaseDeps), sendIdleReminders: remind,
    async listNativeTerminals(actor, taskId) {
      const pageQuery = activityPage(actor, taskId);
      const phasesQuery = deps.executions?.phases(taskId).catch(() => new Map()) ?? Promise.resolve(new Map());
      const [roster, page, phases] = await Promise.all([native.listNativeTerminals(actor, taskId), pageQuery, phasesQuery]);
      return { ...roster, activitySync: page?.sync ?? 'unavailable', items: roster.items.map((item) => withExecutionPhase({ ...item, activity: page?.states.find((state) => state.agentId === item.agentId && state.terminalId === item.terminalId && state.runnerId === item.runnerId) }, item.execution ? phases.get(item.execution.taskId) : undefined)) };
    },
  };
  return projectWork ? developmentWorkApi(api, projectWork) : api;

}
