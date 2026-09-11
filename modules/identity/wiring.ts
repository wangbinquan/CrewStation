import { join } from 'node:path';
import type { Clock } from '@crewstation/kernel';
import { systemClock } from '@crewstation/kernel';
import type { Database, MigrationSet } from '@crewstation/persistence';
import { readMigrationDir } from '@crewstation/persistence';
import { drizzleUserRepository } from './adapters/persistence/drizzleUserRepository';
import type { IdentityModuleApi } from './api/moduleApi';
import { ensureUserUseCase } from './application/ensureUser';
import { queryUsersUseCases } from './application/queryUsers';
import type { IdentitySettings } from './ports/identitySettings';

export interface IdentityModuleDeps {
  db: Database;
  settings: IdentitySettings;
  clock?: Clock;
}

export interface IdentityModule {
  readonly api: IdentityModuleApi;
  readonly migrations: MigrationSet;
}

export const identityMigrations: MigrationSet = {
  module: 'identity',
  layer: 1,
  files: readMigrationDir(join(import.meta.dir, 'adapters', 'persistence', 'migrations')),
};

export function createIdentityModule(deps: IdentityModuleDeps): IdentityModule {
  const users = drizzleUserRepository(deps.db);
  const clock = deps.clock ?? systemClock;
  return {
    api: { name: 'identity', ensureUser: ensureUserUseCase({ users, settings: deps.settings, clock }), ...queryUsersUseCases(users) },
    migrations: identityMigrations,
  };
}
