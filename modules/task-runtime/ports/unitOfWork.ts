import type { DomainPayload, DomainTopicName } from '@crewstation/contracts';
import type { AdmissionRepository, EnvironmentRepository } from './repositories';

export interface DomainEventPublisher {
  publish<T extends DomainTopicName>(topic: T, payload: DomainPayload<T>): Promise<void>;
}

export interface RepositoryScope {
  readonly environments: EnvironmentRepository;
  readonly admissions: AdmissionRepository;
  readonly events: DomainEventPublisher;
}

export interface UnitOfWork {
  readonly read: RepositoryScope;
  run<T>(fn: (scope: RepositoryScope) => Promise<T>): Promise<T>;
}
