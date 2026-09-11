import { join } from 'node:path';
import type { ProjectId, UserId } from '@crewstation/contracts';
import type { AppEnv } from '@crewstation/http';
import type { K8sClient } from '@crewstation/k8s';
import type { Clock, Logger } from '@crewstation/kernel';
import { noopLogger, systemClock } from '@crewstation/kernel';
import type { Database, MigrationSet } from '@crewstation/persistence';
import { readMigrationDir } from '@crewstation/persistence';
import type { Hono } from 'hono';
import { kubernetesClusterObserver } from './adapters/k8s/clusterObserver';
import { drizzleAlertRepository, drizzleAlertSubscriptionRepository } from './adapters/persistence/drizzleRepositories';
import type { ObservabilityModuleApi } from './api/moduleApi';
import { alertingUseCases } from './application/alerting';
import type { ObservabilityUseCaseDeps } from './application/dependencies';
import { logsAndHealthUseCases } from './application/logsAndHealth';
import { traceReplayUseCase } from './application/traceReplay';
import { observabilityRoutes } from './http/observabilityRoutes';
import type { ClusterObserver, Notifier, ProjectAuthorizer, ServiceResolver, SlotRoles, TraceSources } from './ports/sources';

export interface ObservabilityModuleDeps {
  db: Database;
  k8s: K8sClient;
  authorizer: ProjectAuthorizer;
  services: ServiceResolver;
  slots: SlotRoles;
  traces: TraceSources;
  notifier: Notifier;
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
    alerts: drizzleAlertRepository(deps.db), subscriptions: drizzleAlertSubscriptionRepository(deps.db), cluster: deps.cluster ?? kubernetesClusterObserver(deps.k8s),
    authorizer: deps.authorizer, services: deps.services, slots: deps.slots, traces: deps.traces, notifier: deps.notifier, clock: deps.clock ?? systemClock, logger,
  };
  const alerting = alertingUseCases(useCaseDeps);
  const api: ObservabilityModuleApi = { name: 'observability', ...logsAndHealthUseCases(useCaseDeps), ...alerting, replayTrace: traceReplayUseCase(useCaseDeps) };
  let timer: ReturnType<typeof setInterval> | undefined;
  const sweepAll = async (): Promise<void> => { for (const projectId of await (deps.listProjectIds?.() ?? Promise.resolve([]))) await alerting.sweepProject(projectId).catch((e: unknown) => logger.warn('alert sweep failed', { projectId, error: String(e) })); };
  return {
    api,
    http: [observabilityRoutes(api, deps.isAdmin)],
    workers: [{ start: () => { timer ??= setInterval(() => void sweepAll(), 30_000); }, stop: async () => { if (timer) clearInterval(timer); timer = undefined; } }],
    migrations: observabilityMigrations,
  };
}
