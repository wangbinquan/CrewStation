import { join } from 'node:path';
import type { ProjectDeletionContext, ProjectId, ServiceId, UserId } from '@crewstation/contracts';
import { DomainTopic, TaskIdSchema } from '@crewstation/contracts';
import type { EventConsumer } from '@crewstation/eventbus';
import { createEventConsumer } from '@crewstation/eventbus';
import type { AppEnv } from '@crewstation/http';
import type { K8sClient } from '@crewstation/k8s';
import type { Clock, Logger } from '@crewstation/kernel';
import { noopLogger, precondition, systemClock } from '@crewstation/kernel';
import type { Database, MigrationSet, ResourceIdentityDirectory } from '@crewstation/persistence';
import { readMigrationDir } from '@crewstation/persistence';
import type { Hono } from 'hono';
import { traefikApplier } from './adapters/k8s/traefikApplier';
import { drizzleRateLimitRepository } from './adapters/persistence/drizzleRateLimits';
import { drizzleAllowlistRepository, drizzlePodIdentityRepository, drizzleRouteRepository } from './adapters/persistence/drizzleRepositories';
import { drizzleMaintenanceUnitOfWork } from './adapters/persistence/drizzleMaintenance';
import { gatewayDeletionRepository } from './adapters/persistence/projectDeletion';
import { gatewayDeletionOwner } from './application/projectDeletion';
import type { GatewayModuleApi } from './api/moduleApi';
import { allowlistUseCases } from './application/allowlist';
import type { GatewayUseCaseDeps } from './application/dependencies';
import { maintenanceUseCases } from './application/maintenance';
import { checkAllowlist } from './application/allowlistCheck';
import { observedPodOf, podIdentityUseCases } from './application/podIdentities';
import { rateLimitUseCases } from './application/rateLimits';
import { resourceRateLimitUseCases } from './application/resourceRateLimits';
import { routeUseCases } from './application/reconcileRoutes';
import { gatewayRoutes } from './http/gatewayRoutes';
import { maintenanceRoutes } from './http/maintenanceRoutes';
import { rateLimitRoutes } from './http/rateLimitRoutes';
import type { UnavailablePage } from './http/unavailableRoutes';
import { unavailableRoutes } from './http/unavailableRoutes';
import { explainUnavailable } from './application/unavailable';
import type { GrantSource, HostNaming, ProjectAccess, ServiceDirectory, SlotRoles, UserDirectory } from './ports/directories';
import type { GatewayApplier, GatewaySettings } from './ports/gatewayApply';
import { allowlistCheckWorker } from './workers/allowlistCheck';
import { gatewayProcessRecoveryWorker, identityTombstoneWorker } from './workers/identityTombstones';
import type { GatewayOriginalDirectory, GatewayProcessOwners } from './ports/repositories';
import { rateLimitLedgerResyncWorker } from './workers/rateLimitLedgerResync';
import { routeLedgerResyncWorker } from './workers/routeLedgerResync';
import type { LedgerReader, RouteLedger } from './ports/ledger';

export interface GatewayModuleDeps {
  originals?: GatewayOriginalDirectory;
  processes?: GatewayProcessOwners;
  projects?: { assertProjectAvailable(id: ProjectId): Promise<void>; assertProjectDeletionGrant(context: ProjectDeletionContext): Promise<void>; available?(id: ProjectId): Promise<boolean>; availableMany?(ids: readonly ProjectId[]): Promise<readonly ProjectId[]> };
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
  /** 资源台账（RFC-025 第三期后半）：路由投影成 route 记录；缺省不投影。 */
  ledger?: RouteLedger;
  /** 说明页（RFC-025 设计 §7.2，D13）：读台账里的路由与槽记录，用 identity 的页面渲染；两样都给才挂说明页的路由。 */
  explainer?: { readonly reader: LedgerReader; readonly page: UnavailablePage };
  clock?: Clock;
  logger?: Logger;
}

export interface GatewayModule {
  readonly api: GatewayModuleApi;
  readonly http: Hono<AppEnv>[];
  /** 身份索引的墓碑清理、放行表定时核对；配了资源台账时另有路由补投影。身份索引本身由 cluster-control 的 Pod 观测驱动（RFC-025 设计 §7.4）。 */
  readonly workers: readonly { start(): void; stop(): Promise<void> }[];
  readonly subscriptions: EventConsumer;
  readonly migrations: MigrationSet;
}

export const gatewayMigrations: MigrationSet = {
  module: 'gateway',
  layer: 5,
  files: readMigrationDir(join(import.meta.dir, 'adapters', 'persistence', 'migrations')),
};

function originalsOf(deps: GatewayModuleDeps): GatewayOriginalDirectory {
  if (deps.originals) return deps.originals;
  if (deps.projects) throw precondition('正式网关原身份目录尚未装配');
  const service = async (key: string) => await deps.services.getService(key as ServiceId) ?? await deps.services.resolveIdentity?.(key) ?? (await deps.services.listServices()).find((s) => s.identity === key);
  return { service, pod: async (record) => (await service(`${record.project}/${record.service}`))?.projectId,
    operation: async (key) => {
      if (deps.grants.originalOperationProject) return deps.grants.originalOperationProject(key);
      const route = (await deps.grants.grantedOperations('none/none')).operationRoutes.find((r) => r.id === key);
      return route ? (await deps.services.listServices()).find((s) => s.serviceName === route.proxy)?.projectId : undefined;
    } };
}

export function createGatewayModule(deps: GatewayModuleDeps): GatewayModule {
  const logger = deps.logger ?? noopLogger;
  const deletion = gatewayDeletionRepository(deps.db, { originals: originalsOf(deps), assertGrant: deps.projects?.assertProjectDeletionGrant, assertAvailable: deps.projects?.assertProjectAvailable, available: deps.projects?.available, availableMany: deps.projects?.availableMany, processes: deps.processes });
  const useCaseDeps: GatewayUseCaseDeps = {
    admission: deletion,
    normalizeTaskId: async (value) => TaskIdSchema.safeParse(value).success ? value : deps.identities?.resolve('task', [value]),
    allowlists: drizzleAllowlistRepository(deps.db, deletion),
    pods: drizzlePodIdentityRepository(deps.db, deletion),
    routes: drizzleRouteRepository(deps.db),
    rateLimits: drizzleRateLimitRepository(deps.db),
    maintenanceUow: drizzleMaintenanceUnitOfWork(deps.db),
    access: deps.access,
    users: deps.users,
    applier: deps.applier ?? traefikApplier(deps.k8s, deps.settings),
    ...(deps.ledger ? { ledger: deps.ledger } : {}),
    services: deps.services,
    slots: deps.slots,
    grants: deps.grants,
    hosts: deps.hosts,
    settings: deps.settings,
    clock: deps.clock ?? systemClock,
    logger,
  };
  const limits = rateLimitUseCases(useCaseDeps);
  const routes = routeUseCases(useCaseDeps, { declare: limits.declareProjectRateLimits, release: limits.releaseProjectRateLimits });
  const maintenance = maintenanceUseCases(useCaseDeps);
  const allowlist = allowlistUseCases(useCaseDeps, maintenance.serviceCallBlock);
  const pods = podIdentityUseCases(useCaseDeps);
  const api: GatewayModuleApi = {
    ...(deps.projects ? { deletionOwner: gatewayDeletionOwner(deletion, deps.projects.assertProjectDeletionGrant) } : {}),
    name: 'gateway', ...routes, ...allowlist, evaluate: allowlist.evaluate, lookupByIp: pods.lookupByIp, purgeIdentityTombstones: pods.purgeTombstones, ...maintenance, ...limits, ...resourceRateLimitUseCases(useCaseDeps, deps.isAdmin),
    checkAllowlist: () => checkAllowlist(useCaseDeps, allowlist.verifyAllowlist),
    syncObservedPod: (pod, gone) => pods.syncPod(observedPodOf(pod, gone)),
    relistObservedPods: (list) => pods.relistPods(list.map((pod) => observedPodOf(pod, false))),
  };
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
    http: [
      gatewayRoutes(api, deps.isAdmin), maintenanceRoutes(api, deps.isAdmin), rateLimitRoutes(api, deps.isAdmin),
      ...(deps.explainer ? [unavailableRoutes(explainUnavailable({ ledgerReader: deps.explainer.reader, services: deps.services }), deps.explainer.page)] : []),
    ],
    workers: [
      gatewayProcessRecoveryWorker(deletion.recover, logger),
      identityTombstoneWorker(pods.purgeTombstones, logger), allowlistCheckWorker(api.checkAllowlist, logger),
      ...(deps.ledger ? [routeLedgerResyncWorker(routes.resyncRouteLedger, logger), rateLimitLedgerResyncWorker(limits.resyncRateLimitLedger, logger)] : []),
    ],
    subscriptions,
    migrations: gatewayMigrations,
  };
}
