import { join } from 'node:path';
import type { AppEnv } from '@crewstation/http';
import type { Clock } from '@crewstation/kernel';
import { systemClock } from '@crewstation/kernel';
import type { ProjectModuleApi } from '@crewstation/module-project';
import type { Database, MigrationSet } from '@crewstation/persistence';
import { readMigrationDir } from '@crewstation/persistence';
import type { Hono } from 'hono';
import { createAesGcmSecretCipher } from './adapters/crypto/aesGcmSecretCipher';
import { drizzleUnitOfWork } from './adapters/persistence/drizzleUnitOfWork';
import type { ConfigModuleApi } from './api/moduleApi';
import { deleteConfigItemUseCase } from './application/deleteConfigItem';
import type { ConfigUseCaseDeps } from './application/dependencies';
import { queryConfigUseCases } from './application/queryConfig';
import { renderEnvUseCase } from './application/renderEnv';
import { setConfigItemUseCase } from './application/setConfigItem';
import { validateManifestEnvUseCase } from './application/validateManifestEnv';
import { configRoutes } from './http/configRoutes';
import type { ConfigSettings } from './ports/configSettings';

export interface ConfigModuleDeps {
  db: Database;
  /** 角色表判定与管理员标记都来自 project 模块。 */
  project: Pick<ProjectModuleApi, 'authorize' | 'isAdmin'>;
  settings: ConfigSettings;
  clock?: Clock;
}

export interface ConfigModule {
  readonly api: ConfigModuleApi;
  readonly http: Hono<AppEnv>[];
  readonly migrations: MigrationSet;
}

export const configMigrations: MigrationSet = {
  module: 'config',
  layer: 3,
  files: readMigrationDir(join(import.meta.dir, 'adapters', 'persistence', 'migrations')),
};

export function createConfigModule(deps: ConfigModuleDeps): ConfigModule {
  const useCaseDeps: ConfigUseCaseDeps = {
    uow: drizzleUnitOfWork(deps.db),
    cipher: createAesGcmSecretCipher(deps.settings.secretKeyBase64),
    authorizer: { authorize: (actor, projectId, action) => deps.project.authorize(actor, projectId, action) },
    clock: deps.clock ?? systemClock,
  };
  const api: ConfigModuleApi = {
    name: 'config',
    setItem: setConfigItemUseCase(useCaseDeps),
    deleteItem: deleteConfigItemUseCase(useCaseDeps),
    ...queryConfigUseCases(useCaseDeps),
    renderEnv: renderEnvUseCase(useCaseDeps),
    validateManifestEnv: validateManifestEnvUseCase(useCaseDeps),
  };
  return { api, http: [configRoutes(api, { isAdmin: (userId) => deps.project.isAdmin(userId) })], migrations: configMigrations };
}
