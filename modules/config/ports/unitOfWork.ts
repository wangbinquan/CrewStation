import type { DomainPayload, DomainTopicName } from '@crewstation/contracts';
import type { ConfigItemRepository, ConfigVersionRepository } from './repositories';

export interface DomainEventPublisher {
  publish<T extends DomainTopicName>(topic: T, payload: DomainPayload<T>): Promise<void>;
}

/** 一个事务内可用的全部仓储与事件发布；用例层只通过它访问持久化。 */
export interface RepositoryScope {
  readonly items: ConfigItemRepository;
  readonly versions: ConfigVersionRepository;
  readonly events: DomainEventPublisher;
}

export interface UnitOfWork {
  /** 只读访问，不开事务。 */
  readonly read: RepositoryScope;
  run<T>(fn: (scope: RepositoryScope) => Promise<T>): Promise<T>;
}
