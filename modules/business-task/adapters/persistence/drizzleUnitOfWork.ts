import { publishDomainEvent } from '@crewstation/eventbus';
import type { Database, Executor } from '@crewstation/persistence';
import type { RepositoryScope, UnitOfWork } from '../../ports/repositories';
import { drizzleContractRepository, drizzleSubtaskRepository, drizzleTaskRepository } from './drizzleRepositories';

export function scopeOver(executor: Executor): RepositoryScope {
  return {
    tasks: drizzleTaskRepository(executor),
    subtasks: drizzleSubtaskRepository(executor),
    contracts: drizzleContractRepository(executor),
    events: { publish: async (topic, payload) => { await publishDomainEvent(executor, topic, payload); } },
  };
}

export function drizzleUnitOfWork(db: Database): UnitOfWork {
  return { read: scopeOver(db), run: (fn) => db.transaction((tx) => fn(scopeOver(tx))) };
}
