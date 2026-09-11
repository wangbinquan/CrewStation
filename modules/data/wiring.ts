import { join } from 'node:path';
import type { UserId } from '@crewstation/contracts';
import type { AppEnv } from '@crewstation/http';
import type { Clock, Logger } from '@crewstation/kernel';
import { noopLogger, systemClock } from '@crewstation/kernel';
import type { Database, MigrationSet } from '@crewstation/persistence';
import { readMigrationDir } from '@crewstation/persistence';
import type { Hono } from 'hono';
import { secretboxCipher } from './adapters/crypto/secretboxCipher';
import { drizzleDataResourceRepository, drizzleTaskBindingRepository } from './adapters/persistence/drizzleRepositories';
import type { PostgresProviderSettings } from './adapters/postgres/bunSqlProvider';
import { bunSqlPostgresProvider } from './adapters/postgres/bunSqlProvider';
import type { DataModuleApi } from './api/moduleApi';
import type { DataUseCaseDeps } from './application/dependencies';
import { serviceDataUseCases } from './application/serviceData';
import { taskBindingUseCases } from './application/taskBindings';
import { dataRoutes } from './http/dataRoutes';
import type { DataSettings, ProjectAuthorizer, ServiceResolver } from './ports/platform';
import type { PostgresProvider } from './ports/providers';

export interface DataModuleDeps {
  db: Database;
  authorizer: ProjectAuthorizer;
  services: ServiceResolver;
  isAdmin: (userId: UserId) => Promise<boolean>;
  settings: DataSettings & { secretKeyBase64: string; postgres: PostgresProviderSettings };
  provider?: PostgresProvider;
  clock?: Clock;
  logger?: Logger;
}

export interface DataModule {
  readonly api: DataModuleApi;
  readonly http: Hono<AppEnv>[];
  readonly migrations: MigrationSet;
}

export const dataMigrations: MigrationSet = {
  module: 'data',
  layer: 3,
  files: readMigrationDir(join(import.meta.dir, 'adapters', 'persistence', 'migrations')),
};

export function createDataModule(deps: DataModuleDeps): DataModule {
  const useCaseDeps: DataUseCaseDeps = {
    resources: drizzleDataResourceRepository(deps.db),
    bindings: drizzleTaskBindingRepository(deps.db),
    postgres: deps.provider ?? bunSqlPostgresProvider(deps.settings.postgres),
    cipher: secretboxCipher(deps.settings.secretKeyBase64),
    authorizer: deps.authorizer,
    services: deps.services,
    settings: deps.settings,
    clock: deps.clock ?? systemClock,
    logger: deps.logger ?? noopLogger,
  };
  const service = serviceDataUseCases(useCaseDeps);
  const bindings = taskBindingUseCases(useCaseDeps);
  const api: DataModuleApi = { name: 'data', ensureServiceData: service.ensureServiceData, envFor: service.envFor, listResources: service.listResources, ...bindings };
  return { api, http: [dataRoutes(api, deps.isAdmin)], migrations: dataMigrations };
}
