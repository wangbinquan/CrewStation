import type { Database, Executor } from '@crewstation/persistence';
import type { RepositoryScope, UnitOfWork } from '../../ports/unitOfWork';
import type { RepositoryWrites } from '../../ports/repositoryWrites';
import { drizzleRepositoryBindingRepository, drizzleSessionCredentialRepository } from './drizzleScmRepositories';

export function scopeOver(executor: Executor): RepositoryScope {
  return {
    bindings: drizzleRepositoryBindingRepository(executor),
    credentials: drizzleSessionCredentialRepository(executor),
  };
}

export function drizzleUnitOfWork(db: Database, writes?: RepositoryWrites): UnitOfWork {
  return {
    ...(writes ? { writes } : {}),
    read: scopeOver(db),
    run: (fn) => { writes?.assertOriginalActive(); return db.transaction((tx) => fn(scopeOver(tx))); },
  };
}
