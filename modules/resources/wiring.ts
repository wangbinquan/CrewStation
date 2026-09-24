import { join } from 'node:path';
import type { UserId } from '@crewstation/contracts';
import { AdminResourceViewQuerySchema, ResourceViewQuerySchema } from '@crewstation/contracts';
import type { Clock, Logger } from '@crewstation/kernel';
import { noopLogger, systemClock } from '@crewstation/kernel';
import type { Database, Executor, MigrationSet } from '@crewstation/persistence';
import { readMigrationDir } from '@crewstation/persistence';
import type { Hono } from 'hono';
import type { AppEnv } from '@crewstation/http';
import type { OwnerLedger, ResourcesModuleApi } from './api/moduleApi';
import type { ResourceActionHandler } from './api/types';
import { performAction } from './application/actions';
import { maintainLedger } from './application/maintenance';
import { observationWriter } from './application/observe';
import { occupancyIn, ownerWriter } from './application/ownerWrites';
import type { StreamOptions } from './application/streamHub';
import { createStreamHub, DEFAULT_STREAM_OPTIONS } from './application/streamHub';
import { readView } from './application/views';
import { viewerAccess } from './application/access';
import { readClaims } from './application/claims';
import { drizzleLedgerUnitOfWork } from './adapters/persistence/drizzleLedger';
import type { QuotaLimits, ResourceAuthorizer } from './ports/platform';
import { resourceRoutes } from './http/resourceRoutes';

export const resourcesMigrations: MigrationSet = { module: 'resources', layer: 1, files: readMigrationDir(join(import.meta.dir, 'adapters', 'persistence', 'migrations')) };

/** 装配期注入：额度上限与授权由组合根从 project／identity 模块回答。 */
export interface ResourcesModuleDeps {
  readonly db: Database;
  readonly quotas: QuotaLimits;
  readonly authorizer: ResourceAuthorizer;
  isAdmin(id: UserId): Promise<boolean>;
  readonly clock?: Clock;
  readonly logger?: Logger;
  readonly stream?: Partial<StreamOptions>;
  /** 维护（保留期、压缩、清理）的周期；只在 cs-controller 里跑。 */
  readonly maintenanceMs?: number;
}

export interface ResourcesModule {
  readonly api: ResourcesModuleApi;
  readonly http: Hono<AppEnv>[];
  /** cs-api：推送流的尾随器。 */
  readonly streamWorker: { start(): void; stop(): Promise<void> };
  /** cs-controller：保留期到期、压缩、变更日志与租约清理。 */
  readonly maintenanceWorker: { start(): void; stop(): Promise<void> };
  readonly migrations: MigrationSet;
  maintainOnce(): Promise<void>;
}

export function createResourcesModule(deps: ResourcesModuleDeps): ResourcesModule {
  const clock = deps.clock ?? systemClock, logger = deps.logger ?? noopLogger;
  const uow = drizzleLedgerUnitOfWork(deps.db);
  const hub = createStreamHub(uow.read, clock, logger, { ...DEFAULT_STREAM_OPTIONS, ...deps.stream });
  const handlers = new Map<string, ResourceActionHandler>();
  const observer = observationWriter(uow, clock);
  // 执行者在装配后才登记（registerActionHandler），每次按当时的登记判定。
  const { projectAccess, adminAccess, accessFor } = viewerAccess({ authorizer: deps.authorizer, executable: (owner, action) => action in centerActions || handlers.has(owner) });
  const owner = (module: string): OwnerLedger => ({
    ...ownerWriter(module, uow.run, deps.quotas, clock),
    within: (tx) => ownerWriter(module, (fn) => fn(uow.within(tx as Executor)), deps.quotas, clock),
  });
  // 删除待回收的工作卷（设计 §6.4、D8）：管理员确认后由资源中心把卷的期望改为「不要了」（以所属模块的名义），调和器按 UID 删 PVC。
  const centerActions = {
    'delete-volume': async ({ actor, record }: Parameters<ResourceActionHandler>[0]) => {
      await owner(record.owner.module).requestRelease(record.id, { code: 'volume-deleted', message: '管理员确认删除工作卷' });
      logger.info('resource volume deletion accepted', { resourceId: record.id, by: actor.userId, pvc: record.spec.children[0]?.name, namespace: record.spec.children[0]?.namespace });
    },
  };
  const api: ResourcesModuleApi = {
    name: 'resources',
    owner,
    observe: observer.observe,
    observeConditions: observer.observeConditions,
    leases: { acquire: uow.read.leases.acquire, renew: uow.read.leases.renew, release: uow.read.leases.release },
    get: (id) => uow.read.records.get(id),
    list: (filter) => uow.read.records.list(filter),
    resolveAlias: (alias) => uow.read.records.resolveAlias(alias),
    claimOf: (child) => uow.read.records.findByChild(child),
    claimsOf: (actor, list) => readClaims(uow.read, clock.now(), accessFor(actor), list),
    occupancy: (projectId) => occupancyIn(uow.read, projectId),
    changesSince: async (cursor, limit) => (await uow.read.changes.since(cursor, limit)).map((entry) => ({ seq: entry.seq, resourceId: entry.resourceId })),
    latestChange: () => uow.read.changes.latest(),
    view: async (actor, projectId, query) => {
      const access = await projectAccess(actor, projectId);
      const parsed = ResourceViewQuerySchema.parse(query);
      return readView(uow.read, { projectId, ...(parsed.kind ? { kind: parsed.kind } : {}), ...(parsed.parent ? { parentId: parsed.parent } : {}), includeStopped: parsed.includeStopped === 'true' }, access, clock.now());
    },
    adminView: async (actor, query) => {
      const access = await adminAccess(actor);
      const parsed = AdminResourceViewQuerySchema.parse(query);
      return readView(uow.read, { ...(parsed.projectId ? { projectId: parsed.projectId } : {}), ...(parsed.kind ? { kind: parsed.kind } : {}), ...(parsed.parent ? { parentId: parsed.parent } : {}), includeStopped: parsed.includeStopped === 'true' }, access, clock.now());
    },
    projectAccess,
    adminAccess,
    checkStreamCapacity: hub.checkCapacity,
    subscribe: hub.subscribe,
    performAction: (actor, id, action, request) => performAction({
      read: uow.read, clock, handlers, centerActions,
      access: (who, record) => (record.projectId ? projectAccess(who, record.projectId) : adminAccess(who)),
    }, actor, id, action, request),
    registerActionHandler: (module, handler) => { handlers.set(module, handler); },
  };
  let timer: ReturnType<typeof setInterval> | undefined;
  const maintainOnce = () => maintainLedger(uow, clock, logger);
  return {
    api,
    http: [resourceRoutes(api, (id) => deps.isAdmin(id as UserId))],
    streamWorker: { start: hub.start, stop: hub.stop },
    maintenanceWorker: {
      start: () => { timer ??= setInterval(() => void maintainOnce(), deps.maintenanceMs ?? 60_000); },
      stop: async () => { if (timer) clearInterval(timer); timer = undefined; },
    },
    migrations: resourcesMigrations,
    maintainOnce,
  };
}
