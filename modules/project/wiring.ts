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
import { computeProfileUseCases } from './application/manageComputeProfiles';
import { queryProjectUseCases } from './application/queryProjects';
import { catalogRoutes } from './http/catalogRoutes';
import { projectRoutes } from './http/projectRoutes';
import { appListingRoutes } from './http/appListingRoutes';
import { appVisibilityUseCases } from './application/appVisibility';
import { marketListingUseCases } from './application/marketListings';
import { projectPageUseCases } from './application/projectPages';
import type { HostNaming } from './ports/hostNaming';
import type { ProjectSettings } from './ports/projectSettings';
import type { RuntimeConfigDirectory } from './ports/runtimeConfigs';
import type { TaskUsage } from './ports/taskUsage';

export interface ProjectModuleDeps {
  db: Database;
  identity: Pick<IdentityModuleApi, 'isAdmin' | 'getUser' | 'findByEmail'>;
  hosts: HostNaming;
  settings: ProjectSettings;
  /** 并发任务占用数；缺省恒为 0（无任务运行时的单元测试与 CLI）。 */
  taskUsage?: TaskUsage;
  /** 运行环境目录（RFC-004）；缺省一律回答不存在，即只允许部署配置模式。 */
  runtimeConfigs?: RuntimeConfigDirectory;
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
    users: { isAdmin: (id) => deps.identity.isAdmin(id), getUser: (id) => deps.identity.getUser(id), findByEmail: (email) => deps.identity.findByEmail(email) },
    hosts: deps.hosts,
    settings: deps.settings,
    taskUsage: deps.taskUsage ?? { runningTasks: async () => 0 },
    runtimeConfigs: deps.runtimeConfigs ?? { describe: async () => undefined },
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
    ...computeProfileUseCases(useCaseDeps),
    ...appVisibilityUseCases(useCaseDeps),
    ...marketListingUseCases(useCaseDeps),
    ...projectPageUseCases(useCaseDeps),
  };
  return { api, http: [projectRoutes(api), catalogRoutes(api), appListingRoutes(api)], migrations: projectMigrations };
}
