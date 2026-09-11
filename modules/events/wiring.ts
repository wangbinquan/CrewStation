import { join } from 'node:path';
import { DomainTopic } from '@crewstation/contracts';
import type { EventConsumer } from '@crewstation/eventbus';
import { createEventConsumer } from '@crewstation/eventbus';
import type { AppEnv } from '@crewstation/http';
import type { Clock, Logger } from '@crewstation/kernel';
import { systemClock } from '@crewstation/kernel';
import type { ProjectModuleApi } from '@crewstation/module-project';
import type { Database, MigrationSet } from '@crewstation/persistence';
import { readMigrationDir } from '@crewstation/persistence';
import type { Worker } from '@crewstation/queue';
import type { Hono } from 'hono';
import { fetchEventPusher } from './adapters/http-client/fetchEventPusher';
import { drizzleUnitOfWork } from './adapters/persistence/drizzleUnitOfWork';
import type { EventsModuleApi } from './api/moduleApi';
import { deliverEventUseCase } from './application/deliverEvent';
import type { EventsUseCaseDeps } from './application/dependencies';
import { produceEventUseCase } from './application/produceEvent';
import { eventQueryUseCases } from './application/queryEvents';
import { registerReleaseUseCase } from './application/registerRelease';
import { replayDeliveryUseCase } from './application/replayDelivery';
import { ingressRoutes } from './http/ingressRoutes';
import { queryRoutes } from './http/queryRoutes';
import type { EventPusher } from './ports/eventPusher';
import type { EventsSettings } from './ports/eventsSettings';
import type { HandlerEndpointResolver } from './ports/handlerEndpointResolver';
import type { ServiceResolver } from './ports/serviceResolver';
import { createDeliveryWorker } from './workers/deliveryWorker';

/** 装配期注入：其他模块的能力以端口形式出现在这里，由应用提供实现。 */
export interface EventsModuleDeps {
  db: Database;
  /** project 模块：管理员标记与项目内授权。 */
  projects: Pick<ProjectModuleApi, 'isAdmin' | 'authorize'>;
  /** 服务 ID → 归属（slug、身份）；由应用基于 project 模块装配。 */
  services: ServiceResolver;
  /** 订阅方 active prod 槽的服务域地址；由应用基于 release 模块装配（结构文档 §4.3）。 */
  endpoints: HandlerEndpointResolver;
  settings?: Partial<EventsSettings>;
  /** 缺省用 fetch 直推；测试可替换。 */
  pusher?: EventPusher;
  /** 投递 worker 的租约持有者名与并发；缺省 'events'／4。 */
  worker?: { owner?: string; concurrency?: number };
  clock?: Clock;
  logger?: Logger;
}

export interface EventsModule {
  readonly api: EventsModuleApi;
  /** ingress 挂在 cs-events（服务域），query 挂在 cs-api（用户域）。 */
  readonly http: { readonly ingress: Hono<AppEnv>[]; readonly query: Hono<AppEnv>[] };
  /** 投递 worker（cs-events）。 */
  readonly workers: Worker[];
  /** release.registered 的消费者；承载进程负责 start()／stop()。 */
  readonly subscriptions: EventConsumer[];
  readonly migrations: MigrationSet;
}

const DEFAULT_SETTINGS: EventsSettings = { maxAttempts: 8, pushTimeoutMs: 10_000 };
/** 队列任务上限比投递上限多出的余量：崩溃导致两边计数漂移时，仍由投递状态机先判定 dead。 */
const JOB_ATTEMPT_MARGIN = 2;

export const eventsMigrations: MigrationSet = {
  module: 'events',
  layer: 3,
  files: readMigrationDir(join(import.meta.dir, 'adapters', 'persistence', 'migrations')),
};

export function createEventsModule(deps: EventsModuleDeps): EventsModule {
  const settings: EventsSettings = { ...DEFAULT_SETTINGS, ...deps.settings };
  const logger = deps.logger ? { logger: deps.logger } : {};
  const useCaseDeps: EventsUseCaseDeps = {
    uow: drizzleUnitOfWork(deps.db, { jobMaxAttempts: settings.maxAttempts + JOB_ATTEMPT_MARGIN }),
    services: deps.services,
    projects: { isAdmin: (id) => deps.projects.isAdmin(id), authorize: (actor, projectId, action) => deps.projects.authorize(actor, projectId, action) },
    endpoints: deps.endpoints,
    pusher: deps.pusher ?? fetchEventPusher({ timeoutMs: settings.pushTimeoutMs }),
    settings,
    clock: deps.clock ?? systemClock,
  };
  const api: EventsModuleApi = {
    name: 'events',
    isAdmin: (userId) => deps.projects.isAdmin(userId),
    produce: produceEventUseCase(useCaseDeps),
    ...eventQueryUseCases(useCaseDeps),
    replayDelivery: replayDeliveryUseCase(useCaseDeps),
    deliver: deliverEventUseCase(useCaseDeps),
  };
  // 登记在自己的事务里原子落库（消费者对处理器抛错不回滚）；至少一次投递靠登记的幂等性吸收，超过重试次数进入死信。
  const registerRelease = registerReleaseUseCase(useCaseDeps);
  const consumer = createEventConsumer({ db: deps.db, consumer: 'events', ...logger })
    .on(DomainTopic.releaseRegistered, (event) => registerRelease(event.payload));
  const worker = createDeliveryWorker({ db: deps.db, deliver: api.deliver, owner: deps.worker?.owner ?? 'events', concurrency: deps.worker?.concurrency ?? 4, ...logger });
  return {
    api,
    http: { ingress: [ingressRoutes(api)], query: [queryRoutes(api)] },
    workers: [worker],
    subscriptions: [consumer],
    migrations: eventsMigrations,
  };
}
