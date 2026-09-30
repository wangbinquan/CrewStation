import { drizzleAppIcons } from './drizzleAppIcons';
import { publishDomainEvent } from '@crewstation/eventbus';
import type { Database, Executor } from '@crewstation/persistence';
import type { RepositoryScope, UnitOfWork } from '../../ports/unitOfWork';
import { drizzleCatalogRepository, drizzleQuotaRepository } from './drizzleCatalogRepositories';
import { drizzleMembershipRepository, drizzleProjectRepository, drizzleServiceRepository } from './drizzleProjectRepositories';
import { drizzleAppListings } from './drizzleAppListings';
import { drizzleAccessRequests } from './drizzleAccessRequests';
import { drizzleProjectPages } from './drizzleProjectPages';
import { drizzleServicePolicies } from './drizzleServicePolicies';
import { drizzleResourcePolicies } from './drizzleResourcePolicies';
import { drizzleProjectDeletions } from './deletion/repository';
import { precondition } from '@crewstation/kernel';

export function scopeOver(executor: Executor): RepositoryScope {
  return {
    projects: drizzleProjectRepository(executor),
    services: drizzleServiceRepository(executor),
    memberships: drizzleMembershipRepository(executor),
    quotas: drizzleQuotaRepository(executor),
    catalog: drizzleCatalogRepository(executor),
    appIcons: drizzleAppIcons(executor),
    appListings: drizzleAppListings(executor),
    accessRequests: drizzleAccessRequests(executor),
    projectPages: drizzleProjectPages(executor),
    servicePolicies: drizzleServicePolicies(executor),
    resourcePolicies: drizzleResourcePolicies(executor),
    deletions: drizzleProjectDeletions(executor),
    events: { publish: async (topic, payload) => { await publishDomainEvent(executor, topic, payload); } },
  };
}

export function drizzleUnitOfWork(db: Database): UnitOfWork {
  return {
    read: scopeOver(db),
    run: async (fn) => {
      try { return await db.transaction((tx) => fn(scopeOver(tx))); }
      catch (error) {
        const cause = (error as { cause?: { code?: string; message?: string } })?.cause;
        if (cause?.code === '55000' && cause.message === 'project is deleting') throw precondition('项目正在永久删除，不能继续写入');
        throw error;
      }
    },
  };
}
