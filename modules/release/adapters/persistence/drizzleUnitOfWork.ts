import { publishDomainEvent } from '@crewstation/eventbus';
import type { Database, Executor } from '@crewstation/persistence';
import type { RepositoryScope, UnitOfWork } from '../../ports/unitOfWork';
import { drizzleReleaseRepository, drizzleSlotRepository, drizzleTrafficSwitchRepository } from './drizzleRepositories';

export function scopeOver(executor: Executor, lockSlots = false): RepositoryScope {
  return {
    releases: drizzleReleaseRepository(executor),
    slots: drizzleSlotRepository(executor, lockSlots),
    switches: drizzleTrafficSwitchRepository(executor),
    events: { publish: async (topic, payload) => { await publishDomainEvent(executor, topic, payload); } },
  };
}

export function drizzleUnitOfWork(db: Database): UnitOfWork {
  return { read: scopeOver(db), run: (fn) => db.transaction((tx) => fn(scopeOver(tx, true))) };
}
