import { join } from 'node:path';
import type { AppEnv } from '@crewstation/http';
import type { Clock } from '@crewstation/kernel';
import { systemClock } from '@crewstation/kernel';
import type { ProjectModuleApi } from '@crewstation/module-project';
import type { Database, MigrationSet } from '@crewstation/persistence';
import { readMigrationDir } from '@crewstation/persistence';
import type { Hono } from 'hono';
import { drizzleUnitOfWork } from './adapters/persistence/drizzleUnitOfWork';
import type { EgressModuleApi } from './api/moduleApi';
import { blockedUseCases } from './application/blockedRecords';
import type { EgressUseCaseDeps } from './application/dependencies';
import { policyUseCases } from './application/egressPolicy';
import { entryUseCases } from './application/manageEntries';
import { requestUseCases } from './application/requestEntries';
import { requestPageUseCase } from './application/requestPages';
import { egressRoutes } from './http/egressRoutes';
import { internalEgressRoutes } from './http/internalRoutes';

export interface EgressModuleDeps {
  db: Database;
  /** 角色表判定与管理员标记都来自 project 模块。 */
  project: Pick<ProjectModuleApi, 'authorize' | 'isAdmin' | 'readProjectBasics'>;
  clock?: Clock;
}

export interface EgressModule {
  readonly api: EgressModuleApi;
  /** 用户域路由与服务域内部路由；应用按进程职责挂载。 */
  readonly http: Hono<AppEnv>[];
  readonly migrations: MigrationSet;
}

export const egressMigrations: MigrationSet = {
  module: 'egress',
  layer: 3,
  files: readMigrationDir(join(import.meta.dir, 'adapters', 'persistence', 'migrations')),
};

export function createEgressModule(deps: EgressModuleDeps): EgressModule {
  const useCaseDeps: EgressUseCaseDeps = {
    uow: drizzleUnitOfWork(deps.db),
    authorizer: { authorize: (actor, projectId, action) => deps.project.authorize(actor, projectId, action), readProjectBasics: (actor, ids) => deps.project.readProjectBasics(actor, ids) },
    clock: deps.clock ?? systemClock,
  };
  const api: EgressModuleApi = {
    name: 'egress',
    ...entryUseCases(useCaseDeps),
    ...requestUseCases(useCaseDeps),
    listRequestPage: requestPageUseCase(useCaseDeps),
    ...policyUseCases(useCaseDeps),
    ...blockedUseCases(useCaseDeps),
  };
  return { api, http: [egressRoutes(api, { isAdmin: (userId) => deps.project.isAdmin(userId) }), internalEgressRoutes(api)], migrations: egressMigrations };
}
