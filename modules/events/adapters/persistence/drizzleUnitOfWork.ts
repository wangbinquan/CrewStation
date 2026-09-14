import type { Database, Executor } from '@crewstation/persistence';
import type { RepositoryScope, UnitOfWork } from '../../ports/unitOfWork';
import { queueDeliveryScheduler } from '../queue/queueDeliveryScheduler';
import { drizzleDeliveryRepository, drizzleInboxRepository } from './drizzleDeliveryRepositories';
import { drizzleEventTypeRepository, drizzleProducerRepository, drizzleSubscriptionRepository } from './drizzleRegistryRepositories';

export interface UnitOfWorkOptions {
  /** 投递任务在队列中的尝试上限（含余量）。 */
  readonly jobMaxAttempts: number;
}

export function scopeOver(executor: Executor, options: UnitOfWorkOptions, lockDeliveries = false): RepositoryScope {
  return {
    producers: drizzleProducerRepository(executor),
    eventTypes: drizzleEventTypeRepository(executor),
    subscriptions: drizzleSubscriptionRepository(executor),
    inbox: drizzleInboxRepository(executor),
    deliveries: drizzleDeliveryRepository(executor, lockDeliveries),
    scheduler: queueDeliveryScheduler(executor, options.jobMaxAttempts),
  };
}

export function drizzleUnitOfWork(db: Database, options: UnitOfWorkOptions): UnitOfWork {
  return {
    read: scopeOver(db, options),
    run: (fn) => db.transaction((tx) => fn(scopeOver(tx, options, true))),
  };
}
