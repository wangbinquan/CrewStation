import type { Database, Executor } from '@crewstation/persistence';
import type { RepositoryScope, UnitOfWork } from '../../ports/unitOfWork';
import { drizzleBlockedRecordRepository, drizzleEgressEntryRepository, drizzleEgressRequestRepository } from './drizzleEgressRepositories';

export function scopeOver(executor: Executor): RepositoryScope {
  return {
    entries: drizzleEgressEntryRepository(executor),
    requests: drizzleEgressRequestRepository(executor),
    blocked: drizzleBlockedRecordRepository(executor),
  };
}

export function drizzleUnitOfWork(db: Database): UnitOfWork {
  return {
    read: scopeOver(db),
    run: (fn) => db.transaction((tx) => fn(scopeOver(tx))),
  };
}
