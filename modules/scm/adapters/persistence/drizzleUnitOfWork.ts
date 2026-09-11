import type { Database, Executor } from '@crewstation/persistence';
import type { RepositoryScope, UnitOfWork } from '../../ports/unitOfWork';
import { drizzleRepositoryBindingRepository, drizzleSessionCredentialRepository } from './drizzleScmRepositories';

export function scopeOver(executor: Executor): RepositoryScope {
  return {
    bindings: drizzleRepositoryBindingRepository(executor),
    credentials: drizzleSessionCredentialRepository(executor),
  };
}

export function drizzleUnitOfWork(db: Database): UnitOfWork {
  return {
    read: scopeOver(db),
    run: (fn) => db.transaction((tx) => fn(scopeOver(tx))),
  };
}
