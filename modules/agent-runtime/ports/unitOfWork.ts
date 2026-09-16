import type { RuntimeCheckId } from '@crewstation/contracts';
import type { RuntimeCheckRepository, RuntimeConfigRepository, RuntimeCredentialRepository, RuntimeRevisionRepository } from './repositories';

export interface RepositoryScope {
  readonly configs: RuntimeConfigRepository;
  readonly revisions: RuntimeRevisionRepository;
  readonly credentials: RuntimeCredentialRepository;
  readonly checks: RuntimeCheckRepository;
  readonly checkQueue: { enqueue(checkId: RuntimeCheckId): Promise<void> };
}

export interface UnitOfWork {
  readonly read: RepositoryScope;
  run<T>(fn: (scope: RepositoryScope) => Promise<T>): Promise<T>;
}
