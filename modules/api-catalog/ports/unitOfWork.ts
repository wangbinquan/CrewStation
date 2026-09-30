import type { DomainPayload, DomainTopicName } from '@crewstation/contracts';
import type { ApiGrantRepository, ApiOperationRepository, ApiProxyRepository, ApiRequestRepository } from './repositories';
import type { ApiAllocations } from './allocations';

export interface DomainEventPublisher {
  publish<T extends DomainTopicName>(topic: T, payload: DomainPayload<T>): Promise<void>;
}

/** 一个事务内可用的全部仓储与事件发布；用例层只通过它访问持久化。 */
export interface RepositoryScope {
  readonly allocations: ApiAllocations;
  readonly proxies: ApiProxyRepository;
  readonly operations: ApiOperationRepository;
  readonly grants: ApiGrantRepository;
  readonly requests: ApiRequestRepository;
  readonly events: DomainEventPublisher;
}

export interface UnitOfWork {
  /** 只读访问，不开事务。 */
  readonly read: RepositoryScope;
  run<T>(fn: (scope: RepositoryScope) => Promise<T>): Promise<T>;
}
