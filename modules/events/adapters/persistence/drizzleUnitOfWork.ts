import type { Database, Executor } from '@crewstation/persistence';
import type { ProjectId } from '@crewstation/contracts';
import type { DeliveryProcessOwners } from '../../ports/deliveryProcesses';
import type { RepositoryScope, UnitOfWork } from '../../ports/unitOfWork';
import { queueDeliveryScheduler } from '../queue/queueDeliveryScheduler';
import { drizzleDeliveryRepository, drizzleInboxRepository } from './drizzleDeliveryRepositories';
import { drizzleEventTypeRepository, drizzleProducerRepository, drizzleSubscriptionRepository } from './drizzleRegistryRepositories';
import { eventsAdmissions } from './projectAdmission';

export interface UnitOfWorkOptions {
  /** 投递任务在队列中的尝试上限（含余量）。 */
  readonly jobMaxAttempts: number;
  readonly assertAvailable?: (projectId: ProjectId) => Promise<void>;
  readonly processes?: DeliveryProcessOwners;
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
    ...eventsAdmissions(db,options.assertAvailable,options.processes),
    run: (fn) => db.transaction((tx) => fn(scopeOver(tx, options, true))),
  };
}
