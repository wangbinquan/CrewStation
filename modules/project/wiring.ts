import { join } from 'node:path';
import type { AppEnv } from '@crewstation/http';
import type { Clock } from '@crewstation/kernel';
import { systemClock } from '@crewstation/kernel';
import type { IdentityModuleApi } from '@crewstation/module-identity';
import type { Database, MigrationSet } from '@crewstation/persistence';
import { readMigrationDir } from '@crewstation/persistence';
import type { Hono } from 'hono';
import { drizzleUnitOfWork } from './adapters/persistence/drizzleUnitOfWork';
import type { ProjectModuleApi } from './api/moduleApi';
import { archiveProjectUseCase } from './application/archiveProject';
import { authorizationUseCases } from './application/authorization';
import { createProjectUseCase } from './application/createProject';
import type { ProjectUseCaseDeps } from './application/dependencies';
import { memberUseCases } from './application/manageMembers';
import { quotaAndPlanUseCases } from './application/manageQuotaAndPlans';
import { queryProjectUseCases } from './application/queryProjects';
import { catalogRoutes } from './http/catalogRoutes';
import { projectRoutes } from './http/projectRoutes';
import type { HostNaming } from './ports/hostNaming';
import type { ProjectSettings } from './ports/projectSettings';
import type { TaskUsage } from './ports/taskUsage';

export interface ProjectModuleDeps {
  db: Database;
  identity: Pick<IdentityModuleApi, 'isAdmin' | 'getUser'>;
  hosts: HostNaming;
  settings: ProjectSettings;
  /** 并发任务占用数；缺省恒为 0（无任务运行时的单元测试与 CLI）。 */
  taskUsage?: TaskUsage;
  clock?: Clock;
}

export interface ProjectModule {
  readonly api: ProjectModuleApi;
  readonly http: Hono<AppEnv>[];
  readonly migrations: MigrationSet;
}

export const projectMigrations: MigrationSet = {
  module: 'project',
  layer: 2,
  files: readMigrationDir(join(import.meta.dir, 'adapters', 'persistence', 'migrations')),
};

export function createProjectModule(deps: ProjectModuleDeps): ProjectModule {
  const useCaseDeps: ProjectUseCaseDeps = {
    uow: drizzleUnitOfWork(deps.db),
    users: { isAdmin: (id) => deps.identity.isAdmin(id), getUser: (id) => deps.identity.getUser(id) },
    hosts: deps.hosts,
    settings: deps.settings,
    taskUsage: deps.taskUsage ?? { runningTasks: async () => 0 },
    clock: deps.clock ?? systemClock,
  };
  const api: ProjectModuleApi = {
    name: 'project',
    isAdmin: (userId) => deps.identity.isAdmin(userId),
    ...authorizationUseCases(useCaseDeps),
    createProject: createProjectUseCase(useCaseDeps),
    archiveProject: archiveProjectUseCase(useCaseDeps),
    ...queryProjectUseCases(useCaseDeps),
    ...memberUseCases(useCaseDeps),
    ...quotaAndPlanUseCases(useCaseDeps),
  };
  return { api, http: [projectRoutes(api), catalogRoutes(api)], migrations: projectMigrations };
}
