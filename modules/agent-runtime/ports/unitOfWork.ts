import type { ProfileTestId } from '@crewstation/contracts';
import type { CredentialRepository, ProjectPolicyRepository, ProfileRepository, RevisionRepository, TestRepository } from './repositories';

export interface RepositoryScope {
  readonly projectPolicies: ProjectPolicyRepository;
  readonly profiles: ProfileRepository;
  readonly revisions: RevisionRepository;
  readonly credentials: CredentialRepository;
  readonly tests: TestRepository;
  readonly testQueue: { enqueue(testId: ProfileTestId): Promise<void> };
}

export interface UnitOfWork {
  readonly read: RepositoryScope;
  run<T>(fn: (scope: RepositoryScope) => Promise<T>): Promise<T>;
}
