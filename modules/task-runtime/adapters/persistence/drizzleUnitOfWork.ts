import { publishDomainEvent } from '@crewstation/eventbus';
import type { Database, Executor } from '@crewstation/persistence';
import type { RepositoryScope, UnitOfWork } from '../../ports/unitOfWork';
import { drizzleAdmissionRepository, drizzleEnvironmentRepository } from './drizzleRepositories';

export function scopeOver(executor: Executor): RepositoryScope {
  return {
    environments: drizzleEnvironmentRepository(executor),
    admissions: drizzleAdmissionRepository(executor),
    events: { publish: async (topic, payload) => { await publishDomainEvent(executor, topic, payload); } },
  };
}

export function drizzleUnitOfWork(db: Database): UnitOfWork {
  return { read: scopeOver(db), run: (fn) => db.transaction((tx) => fn(scopeOver(tx))) };
}
