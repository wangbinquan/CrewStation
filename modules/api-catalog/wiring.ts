import { join } from 'node:path';
import type { ServiceId } from '@crewstation/contracts';
import { DomainTopic } from '@crewstation/contracts';
import type { EventConsumer } from '@crewstation/eventbus';
import { createEventConsumer } from '@crewstation/eventbus';
import type { AppEnv } from '@crewstation/http';
import type { Clock, Logger } from '@crewstation/kernel';
import { systemClock } from '@crewstation/kernel';
import type { ProjectModuleApi } from '@crewstation/module-project';
import type { Database, MigrationSet } from '@crewstation/persistence';
import { readMigrationDir } from '@crewstation/persistence';
import type { Hono } from 'hono';
import { drizzleUnitOfWork } from './adapters/persistence/drizzleUnitOfWork';
import type { ApiCatalogModuleApi } from './api/moduleApi';
import { grantUseCases } from './application/decideRequest';
import type { ApiCatalogUseCaseDeps } from './application/dependencies';
import { grantedOperationsUseCase } from './application/grantedOperations';
import { listRequestsUseCase } from './application/listRequests';
import { requestPageUseCase } from './application/requestPages';
import { prunedOpenApiUseCase } from './application/prunedOpenApi';
import { catalogQueryUseCases } from './application/queryCatalog';
import { registerReleaseUseCase } from './application/registerRelease';
import { requestAccessUseCase } from './application/requestAccess';
import { setOpenPolicyUseCase } from './application/setOpenPolicy';
import { catalogRoutes } from './http/catalogRoutes';
import { requestRoutes } from './http/requestRoutes';
import type { HostNaming } from './ports/hostNaming';
import type { ServiceResolver } from './ports/serviceResolver';

/** 装配期注入：其他模块的能力以端口形式出现在这里，由应用提供实现。 */
export interface ApiCatalogModuleDeps {
  db: Database;
  /** project 模块：管理员标记与项目内授权。 */
  projects: Pick<ProjectModuleApi, 'isAdmin' | 'authorize' | 'readProjectBasics'>;
  /** 服务 ID／服务身份 → 归属；由应用基于 project 模块装配。 */
  services: ServiceResolver;
  hosts: HostNaming;
  /** 目录事务提交后更新依赖它的投影；失败沿现有事件消费机制重试，登记本身保持幂等。 */
  onCatalogChanged?: (serviceId: ServiceId) => Promise<void>;
  clock?: Clock;
  logger?: Logger;
}

export interface ApiCatalogModule {
  readonly api: ApiCatalogModuleApi;
  readonly http: Hono<AppEnv>[];
  /** release.registered 的消费者；承载进程负责 start()／stop()。 */
  readonly subscriptions: EventConsumer[];
  readonly migrations: MigrationSet;
}

export const apiCatalogMigrations: MigrationSet = {
  module: 'api-catalog',
  layer: 3,
  files: readMigrationDir(join(import.meta.dir, 'adapters', 'persistence', 'migrations')),
};

export function createApiCatalogModule(deps: ApiCatalogModuleDeps): ApiCatalogModule {
  const useCaseDeps: ApiCatalogUseCaseDeps = {
    uow: drizzleUnitOfWork(deps.db),
    services: deps.services,
    projects: { isAdmin: (id) => deps.projects.isAdmin(id), authorize: (actor, projectId, action) => deps.projects.authorize(actor, projectId, action), readProjectBasics: (actor, ids) => deps.projects.readProjectBasics(actor, ids) },
    hosts: deps.hosts,
    clock: deps.clock ?? systemClock,
  };
  const api: ApiCatalogModuleApi = {
    name: 'api-catalog',
    isAdmin: (userId) => deps.projects.isAdmin(userId),
    ...catalogQueryUseCases(useCaseDeps),
    setOpenPolicy: setOpenPolicyUseCase(useCaseDeps),
    requestAccess: requestAccessUseCase(useCaseDeps),
    listRequests: listRequestsUseCase(useCaseDeps),
    listRequestPage: requestPageUseCase(useCaseDeps),
    ...grantUseCases(useCaseDeps),
    grantedOperations: grantedOperationsUseCase(useCaseDeps),
    prunedOpenApi: prunedOpenApiUseCase(useCaseDeps),
  };
  // 登记在自己的事务里原子落库（消费者对处理器抛错不回滚，不能借用游标事务）；至少一次投递靠登记的幂等性吸收，超过重试次数进入死信。
  const registerRelease = registerReleaseUseCase(useCaseDeps);
  const consumer = createEventConsumer({ db: deps.db, consumer: 'api-catalog', ...(deps.logger ? { logger: deps.logger } : {}) })
    .on(DomainTopic.releaseRegistered, async (event) => {
      await registerRelease(event.payload);
      await deps.onCatalogChanged?.(event.payload.serviceId);
    });
  return { api, http: [catalogRoutes(api), requestRoutes(api)], subscriptions: [consumer], migrations: apiCatalogMigrations };
}
