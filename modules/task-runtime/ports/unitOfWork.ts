import type { DomainPayload, DomainTopicName, TaskId } from '@crewstation/contracts';
import type { AdmissionRepository, EnvironmentRepository } from './repositories';
import type { RebuildQueue, RebuildRepository } from './rebuilds';

export interface DomainEventPublisher {
  publish<T extends DomainTopicName>(topic: T, payload: DomainPayload<T>): Promise<void>;
}

export interface RepositoryScope {
  readonly environments: EnvironmentRepository;
  readonly admissions: AdmissionRepository;
  readonly events: DomainEventPublisher;
  readonly rebuilds: RebuildRepository;
  readonly rebuildQueue: RebuildQueue;
  readonly nativeQueue: { enqueue(taskId: TaskId): Promise<void> };
}

export interface UnitOfWork {
  readonly read: RepositoryScope;
  run<T>(fn: (scope: RepositoryScope) => Promise<T>): Promise<T>;
}
