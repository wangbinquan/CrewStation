import type { RuntimeFactPage, RuntimeFactQuery } from '@crewstation/contracts';
import { developmentUsageReconciliation } from './application/developmentUsage';
import { valueDevelopmentUsagePage } from './application/developmentValuations';
import type { DevelopmentUsageSource } from './ports/developmentUsage';
import { executionValuations, valueRunnerUsagePage } from './application/executionValuations';
import { drizzleExecutionValuations, drizzleUsageLedger, readRuntimeStatisticsLedger } from './adapters/persistence/drizzleUsageLedger';
import { runnerUsageReconciliation, usageIngestion } from './application/usageIngestion';
import { executionObservationUseCases, runtimeStatisticsUseCases } from './application/executionObservations';
import { executionObservationRoutes } from './http/executionObservationRoutes';
import type { ExecutionObservationAccess, RunnerUsageSource } from './ports/usageLedger';
import { join } from 'node:path';
import { drizzleCostVisibility, drizzleExecutionPricing, drizzleTokenPriceStore } from './adapters/persistence/drizzleTokenPricing';
import { tokenPricingUseCases } from './application/tokenPricing';
import { tokenPricingRoutes } from './http/tokenPricingRoutes';
import type { PricingProfileDirectory } from './ports/tokenPricing';
import type { ProjectId, UserId } from '@crewstation/contracts';
import type { AppEnv } from '@crewstation/http';
import type { K8sClient } from '@crewstation/k8s';
import type { Clock, Logger } from '@crewstation/kernel';
import { noopLogger, precondition, systemClock } from '@crewstation/kernel';
import type { Database, Executor, MigrationSet } from '@crewstation/persistence';
import { readMigrationDir } from '@crewstation/persistence';
import type { Hono } from 'hono';
import { kubernetesClusterObserver } from './adapters/k8s/clusterObserver';
import { drizzleAlertRepository } from './adapters/persistence/drizzleRepositories';
import type { ObservabilityModuleApi } from './api/moduleApi';
import { alertingUseCases } from './application/alerting';
import type { ObservabilityUseCaseDeps } from './application/dependencies';
import { logsAndHealthUseCases } from './application/logsAndHealth';
import { traceChainUseCases } from './application/traceChains';
import { observabilityRoutes } from './http/observabilityRoutes';
import type { ClusterObserver, ProjectAuthorizer, ServiceResolver, SlotRecords, SlotRoles } from './ports/sources';
import type { TraceChainSources } from './ports/traceSources';

export interface ObservabilityModuleDeps {
  db: Database;
  runtimeNames?: () => Promise<{ projects: Record<string, string>; profiles: Record<string, string> }>;
  runtimeTasks?: (executor: Executor, query: RuntimeFactQuery) => Promise<RuntimeFactPage>;
  pricingProfiles?: PricingProfileDirectory;
  executionAccess?: ExecutionObservationAccess;
  usageSource?: RunnerUsageSource;
  /** Explicit internal participant; platform production does not supply it yet. */
  developmentUsageSource?: DevelopmentUsageSource;
  k8s: K8sClient;
  authorizer: ProjectAuthorizer;
  services: ServiceResolver;
  slots: SlotRoles;
  /** 服务槽记录（RFC-025 第三期），由组合根接到资源中心；缺省时健康与巡检按请求读集群。 */
  records?: SlotRecords;
  /** 调用链的数据来源（Design §14），由组合根接到 task-runtime、events、business-task 与 session。 */
  traces: TraceChainSources;
  isAdmin: (userId: UserId) => Promise<boolean>;
  /** 巡检的项目来源；缺省不巡检。 */
  listProjectIds?: () => Promise<ProjectId[]>;
  cluster?: ClusterObserver;
  clock?: Clock;
  logger?: Logger;
}

export interface ObservabilityModule {
  readonly api: ObservabilityModuleApi;
  readonly http: Hono<AppEnv>[];
  readonly workers: Array<{ start(): void; stop(): Promise<void> }>;
  readonly migrations: MigrationSet;
}

export const observabilityMigrations: MigrationSet = {
  module: 'observability',
  layer: 6,
  files: readMigrationDir(join(import.meta.dir, 'adapters', 'persistence', 'migrations')),
};

export function createObservabilityModule(deps: ObservabilityModuleDeps): ObservabilityModule {
  const logger = deps.logger ?? noopLogger;
  const useCaseDeps: ObservabilityUseCaseDeps = {
    alerts: drizzleAlertRepository(deps.db), cluster: deps.cluster ?? kubernetesClusterObserver(deps.k8s),
    authorizer: deps.authorizer, services: deps.services, slots: deps.slots, ...(deps.records ? { records: deps.records } : {}), clock: deps.clock ?? systemClock, logger,
  };
  const alerting = alertingUseCases(useCaseDeps);
  const ledger = drizzleUsageLedger(deps.db), executionPricing = drizzleExecutionPricing(deps.db);
  const observations = executionObservationUseCases({ ledger, visibility: drizzleCostVisibility(deps.db), authorizer: deps.authorizer, clock: useCaseDeps.clock,
    access: deps.executionAccess ?? { task: async () => { throw precondition('执行观测来源尚未接入'); } } });
  const valuations = drizzleExecutionValuations(deps.db), valueUsage = executionValuations({ store: valuations, pricing: executionPricing, clock: useCaseDeps.clock });
  const reconcileBusinessUsage = deps.usageSource ? runnerUsageReconciliation({ source: deps.usageSource, store: ledger, logger, value: valueRunnerUsagePage({ store: valuations, source: deps.usageSource, value: valueUsage }) }) : async () => 0;
  const reconcileDevelopment = deps.developmentUsageSource ? developmentUsageReconciliation({ source: deps.developmentUsageSource,
    store: ledger, pricing: executionPricing, logger, value: valueDevelopmentUsagePage({ models: ledger, store: valuations, value: valueUsage }) }) : undefined;
  let pendingUsage: Promise<number> | undefined;
  const reconcileUsage = reconcileDevelopment ? () => pendingUsage ??= (async () => await reconcileBusinessUsage() + await reconcileDevelopment())()
    .finally(() => { pendingUsage = undefined; }) : reconcileBusinessUsage;
  const runtimeStatistics = runtimeStatisticsUseCases({ authorizer: deps.authorizer, clock: useCaseDeps.clock, source: {
    read: async (query) => {
      const snapshot = await deps.db.transaction(async (tx) => {
        if (!deps.runtimeTasks) throw precondition('运行统计任务来源尚未接入');
        return readRuntimeStatisticsLedger(tx, await deps.runtimeTasks(tx, query));
      }, { isolationLevel: 'repeatable read', accessMode: 'read only' });
      // Resolve current display metadata after releasing the ledger transaction, including single-connection pools.
      const names = await deps.runtimeNames?.().catch(() => {
        if (query.q) throw precondition('项目名称目录暂不可用，当前搜索无法完成，请稍后重试');
        logger.warn('runtime display names unavailable'); return undefined;
      });
      if (!names) return snapshot;
      return { ...snapshot, tasks: snapshot.tasks.map((task) => ({ ...task, projectName: names.projects[task.projectId] ?? null,
        attempts: task.attempts.map((attempt) => ({ ...attempt, profileName: attempt.profileId ? names.profiles[attempt.profileId] ?? null : null })) })) };
    },
  } });
  const api: ObservabilityModuleApi = { ...runtimeStatistics,
    name: 'observability', reconcileExecutionUsage: reconcileUsage, valueExecutionUsage: valueUsage,
    acceptExecutionPrice: (input) => executionPricing.accept(input, useCaseDeps.clock.now()), ...observations, ingestExecutionUsage: usageIngestion(ledger), ...logsAndHealthUseCases(useCaseDeps), ...alerting,
    ...tokenPricingUseCases({ store: drizzleTokenPriceStore(deps.db), profiles: deps.pricingProfiles ?? { list: async () => [] }, clock: useCaseDeps.clock }),
    ...traceChainUseCases({ authorizer: deps.authorizer, chains: deps.traces, clock: useCaseDeps.clock }),
  };
  let timer: ReturnType<typeof setInterval> | undefined;
  const sweepAll = async (): Promise<void> => { for (const projectId of await (deps.listProjectIds?.() ?? Promise.resolve([]))) await alerting.sweepProject(projectId).catch((e: unknown) => logger.warn('alert sweep failed', { projectId, error: String(e) })); };
  return {
    api,
    http: [observabilityRoutes(api, deps.isAdmin), tokenPricingRoutes(api, deps.isAdmin), executionObservationRoutes(api, deps.isAdmin)],
    workers: [...(deps.usageSource ? [executionUsageWorker(reconcileUsage, logger)] : []), { start: () => { timer ??= setInterval(() => void sweepAll(), 30_000); }, stop: async () => { if (timer) clearInterval(timer); timer = undefined; } }],
    migrations: observabilityMigrations,
  };
}

function executionUsageWorker(reconcile: () => Promise<number>, logger: Logger) {
  let timer: ReturnType<typeof setInterval> | undefined, running: Promise<void> | undefined;
  const tick = () => running ??= reconcile().then(() => {}, () => { logger.warn('execution usage source unavailable'); }).finally(() => { running = undefined; });
  return { start: () => { if (!timer) { timer = setInterval(() => { void tick(); }, 1000); void tick(); } },
    stop: async () => { if (timer) clearInterval(timer); timer = undefined; await running; } };
}
