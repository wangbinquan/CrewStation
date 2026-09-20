import type { MaintenanceRepository } from './repositories';
import type { DomainPayload, DomainTopicName } from '@crewstation/contracts';
import type { ReleaseRepository, SlotRepository, TrafficSwitchRepository } from './repositories';

export interface DomainEventPublisher {
  publish<T extends DomainTopicName>(topic: T, payload: DomainPayload<T>): Promise<void>;
}

export interface RepositoryScope {
  readonly maintenance: MaintenanceRepository;
  readonly releases: ReleaseRepository;
  readonly slots: SlotRepository;
  readonly switches: TrafficSwitchRepository;
  readonly events: DomainEventPublisher;
}

export interface UnitOfWork {
  readonly read: RepositoryScope;
  run<T>(fn: (scope: RepositoryScope) => Promise<T>): Promise<T>;
}
