import { publishDomainEvent } from '@crewstation/eventbus';
import type { Database, Executor } from '@crewstation/persistence';
import type { RepositoryScope, UnitOfWork } from '../../ports/unitOfWork';
import { drizzleOperationRepository, drizzleProxyRepository } from './drizzleCatalogRepositories';
import { drizzleGrantRepository, drizzleRequestRepository } from './drizzleGrantRepositories';

export function scopeOver(executor: Executor): RepositoryScope {
  return {
    proxies: drizzleProxyRepository(executor),
    operations: drizzleOperationRepository(executor),
    grants: drizzleGrantRepository(executor),
    requests: drizzleRequestRepository(executor),
    events: { publish: async (topic, payload) => { await publishDomainEvent(executor, topic, payload); } },
  };
}

export function drizzleUnitOfWork(db: Database): UnitOfWork {
  return {
    read: scopeOver(db),
    run: (fn) => db.transaction((tx) => fn(scopeOver(tx))),
  };
}
