import { publishDomainEvent } from '@crewstation/eventbus';
import type { Database, Executor } from '@crewstation/persistence';
import type { RepositoryScope, UnitOfWork } from '../../ports/unitOfWork';
import { drizzleCatalogRepository, drizzleQuotaRepository } from './drizzleCatalogRepositories';
import { drizzleMembershipRepository, drizzleProjectRepository, drizzleServiceRepository } from './drizzleProjectRepositories';
import { drizzleAppListings } from './drizzleAppListings';
import { drizzleProjectPages } from './drizzleProjectPages';

export function scopeOver(executor: Executor): RepositoryScope {
  return {
    projects: drizzleProjectRepository(executor),
    services: drizzleServiceRepository(executor),
    memberships: drizzleMembershipRepository(executor),
    quotas: drizzleQuotaRepository(executor),
    catalog: drizzleCatalogRepository(executor),
    appListings: drizzleAppListings(executor),
    projectPages: drizzleProjectPages(executor),
    events: { publish: async (topic, payload) => { await publishDomainEvent(executor, topic, payload); } },
  };
}

export function drizzleUnitOfWork(db: Database): UnitOfWork {
  return {
    read: scopeOver(db),
    run: (fn) => db.transaction((tx) => fn(scopeOver(tx))),
  };
}
