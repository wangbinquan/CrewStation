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
import { drizzleMaintenanceUnitOfWork } from './adapters/persistence/drizzleMaintenance';
import type { GatewayModuleApi } from './api/moduleApi';
import { allowlistUseCases } from './application/allowlist';
import type { GatewayUseCaseDeps } from './application/dependencies';
import { maintenanceUseCases } from './application/maintenance';
import { podIdentityUseCases } from './application/podIdentities';
import { routeUseCases } from './application/reconcileRoutes';
import { gatewayRoutes } from './http/gatewayRoutes';
import { maintenanceRoutes } from './http/maintenanceRoutes';
import type { GrantSource, HostNaming, ProjectAccess, ServiceDirectory, SlotRoles, UserDirectory } from './ports/directories';
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
  /** RFC-021：维护的权限与放行（project）、临时指定的人的名字（identity）。 */
  access: ProjectAccess;
  users: UserDirectory;
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
    maintenanceUow: drizzleMaintenanceUnitOfWork(deps.db),
    access: deps.access,
    users: deps.users,
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
  const maintenance = maintenanceUseCases(useCaseDeps);
  const allowlist = allowlistUseCases(useCaseDeps, maintenance.serviceCallBlock);
  const pods = podIdentityUseCases(useCaseDeps);
  const api: GatewayModuleApi = { name: 'gateway', ...routes, ...allowlist, evaluate: allowlist.evaluate, lookupByIp: pods.lookupByIp, ...maintenance };
  // 发布登记的投影由目录提交后的组合根回调刷新；再独立消费同一发布会让迟到的旧计划覆盖新路由。
  // 放行表是「当前已登记服务」的投影，这个集合一变就得重算：建项目原先只重算路由，新服务于是
  // 根本不在表里，它的开发容器连内置 MCP 与平台 API 全是 403「不能调用平台端点」，要等某次无关的
  // 授权／目录变更或管理员手动「重算」才顺带带上（2026-09-22 本机实撞）。归档同理，反过来。
  const subscriptions = createEventConsumer({ db: deps.db, consumer: deps.settings.consumerName, logger })
    .on(DomainTopic.projectCreated, async (e) => {
      const id = await deps.services.serviceIdOfProject(e.payload.projectId);
      if (id) await routes.reconcileService(id);
      await allowlist.rebuildAllowlist();
    })
    .on(DomainTopic.projectArchived, async (e) => {
      const id = await deps.services.serviceIdOfProject(e.payload.projectId);
      if (id) await routes.removeService(id);
      await allowlist.rebuildAllowlist();
    })
    .on(DomainTopic.trafficSwitched, async (e) => { await routes.reconcileService(e.payload.serviceId); })
    .on(DomainTopic.grantChanged, async () => { await allowlist.rebuildAllowlist(); })
    .on(DomainTopic.openPolicyChanged, async () => { await allowlist.rebuildAllowlist(); });
  return {
    api,
    http: [gatewayRoutes(api, deps.isAdmin), maintenanceRoutes(api, deps.isAdmin)],
    workers: [podWatcher(deps.k8s, pods.syncPod, logger)],
    subscriptions,
    migrations: gatewayMigrations,
  };
}
