import type { DeliveryScheduler } from './deliveryScheduler';
import type { ProjectId } from '@crewstation/contracts';
import type { DeliveryRepository, EventTypeRepository, InboxRepository, ProducerRepository, SubscriptionRepository } from './repositories';

/** 一个事务内可用的全部仓储与入队；用例层只通过它访问持久化。 */
export interface RepositoryScope {
  readonly producers: ProducerRepository;
  readonly eventTypes: EventTypeRepository;
  readonly subscriptions: SubscriptionRepository;
  readonly inbox: InboxRepository;
  readonly deliveries: DeliveryRepository;
  readonly scheduler: DeliveryScheduler;
}

export interface UnitOfWork {
  /** 只读访问，不开事务。 */
  readonly read: RepositoryScope;
  run<T>(fn: (scope: RepositoryScope) => Promise<T>): Promise<T>;
  withAdmission<T>(projectIds: readonly ProjectId[], work: () => Promise<T>): Promise<T>;
  /** pushing=false 仅保护重排／重放，不创建实际推送记录。 */
  withDeliveryAdmission<T>(deliveryId: string, work: () => Promise<T>, pushing?: boolean): Promise<T>;
}
