import { join } from 'node:path';
import type { ProjectId, ServiceId, UserId } from '@crewstation/contracts';
import { DomainTopic, TaskIdSchema } from '@crewstation/contracts';
import type { EventConsumer } from '@crewstation/eventbus';
import { createEventConsumer } from '@crewstation/eventbus';
import type { AppEnv } from '@crewstation/http';
import type { K8sClient } from '@crewstation/k8s';
import type { Clock, Logger } from '@crewstation/kernel';
import { noopLogger, systemClock } from '@crewstation/kernel';
import type { Database, MigrationSet, ResourceIdentityDirectory } from '@crewstation/persistence';
import { readMigrationDir } from '@crewstation/persistence';
import type { Hono } from 'hono';
import { traefikApplier } from './adapters/k8s/traefikApplier';
import { drizzleAllowlistRepository, drizzlePodIdentityRepository, drizzleRouteRepository } from './adapters/persistence/drizzleRepositories';
import type { GatewayModuleApi } from './api/moduleApi';
import { allowlistUseCases } from './application/allowlist';
import type { GatewayUseCaseDeps } from './application/dependencies';
import { podIdentityUseCases } from './application/podIdentities';
import { routeUseCases } from './application/reconcileRoutes';
import { gatewayRoutes } from './http/gatewayRoutes';
import type { GrantSource, HostNaming, ServiceDirectory, SlotRoles } from './ports/directories';
import type { GatewayApplier, GatewaySettings } from './ports/gatewayApply';
import type { PodWatcher } from './workers/podWatcher';
import { podWatcher } from './workers/podWatcher';

export interface GatewayModuleDeps {
  identities?: ResourceIdentityDirectory;
  db: Database;
  k8s: K8sClient;
  services: ServiceDirectory & { serviceIdOfProject(projectId: ProjectId): Promise<ServiceId | undefined> };
  slots: SlotRoles;
  grants: GrantSource;
  hosts: HostNaming;
  isAdmin: (userId: UserId) => Promise<boolean>;
  settings: GatewaySettings & { consumerName: string };
  applier?: GatewayApplier;
  clock?: Clock;
  logger?: Logger;
}

export interface GatewayModule {
  readonly api: GatewayModuleApi;
  readonly http: Hono<AppEnv>[];
  readonly workers: PodWatcher[];
  readonly subscriptions: EventConsumer;
  readonly migrations: MigrationSet;
}

export const gatewayMigrations: MigrationSet = {
  module: 'gateway',
  layer: 5,
  files: readMigrationDir(join(import.meta.dir, 'adapters', 'persistence', 'migrations')),
};

export function createGatewayModule(deps: GatewayModuleDeps): GatewayModule {
  const logger = deps.logger ?? noopLogger;
  const useCaseDeps: GatewayUseCaseDeps = {
    normalizeTaskId: async (value) => TaskIdSchema.safeParse(value).success ? value : deps.identities?.resolve('task', [value]),
    allowlists: drizzleAllowlistRepository(deps.db),
    pods: drizzlePodIdentityRepository(deps.db),
    routes: drizzleRouteRepository(deps.db),
    applier: deps.applier ?? traefikApplier(deps.k8s, deps.settings),
    services: deps.services,
    slots: deps.slots,
    grants: deps.grants,
    hosts: deps.hosts,
    settings: deps.settings,
    clock: deps.clock ?? systemClock,
    logger,
  };
  const routes = routeUseCases(useCaseDeps);
  const allowlist = allowlistUseCases(useCaseDeps);
  const pods = podIdentityUseCases(useCaseDeps);
  const api: GatewayModuleApi = { name: 'gateway', ...routes, ...allowlist, evaluate: allowlist.evaluate, lookupByIp: pods.lookupByIp };
  // 发布登记的投影由目录提交后的组合根回调刷新；再独立消费同一发布会让迟到的旧计划覆盖新路由。
  const subscriptions = createEventConsumer({ db: deps.db, consumer: deps.settings.consumerName, logger })
    .on(DomainTopic.projectCreated, async (e) => { const id = await deps.services.serviceIdOfProject(e.payload.projectId); if (id) await routes.reconcileService(id); })
    .on(DomainTopic.projectArchived, async (e) => { const id = await deps.services.serviceIdOfProject(e.payload.projectId); if (id) await routes.removeService(id); })
    .on(DomainTopic.trafficSwitched, async (e) => { await routes.reconcileService(e.payload.serviceId); })
    .on(DomainTopic.grantChanged, async () => { await allowlist.rebuildAllowlist(); });
  return {
    api,
    http: [gatewayRoutes(api, deps.isAdmin)],
    workers: [podWatcher(deps.k8s, pods.syncPod, logger)],
    subscriptions,
    migrations: gatewayMigrations,
  };
}
