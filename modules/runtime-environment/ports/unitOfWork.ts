import type { BuildRepository, DevelopmentPolicyRepository, ImageRepository, LogRepository, ReferenceRepository, RevisionRepository, ValidationRepository, VersionRepository } from './repositories';

export interface RepositoryScope {
  readonly images: ImageRepository;
  readonly revisions: RevisionRepository;
  readonly builds: BuildRepository;
  readonly versions: VersionRepository;
  readonly validations: ValidationRepository;
  readonly references: ReferenceRepository;
  readonly logs: LogRepository;
  readonly developmentPolicies: DevelopmentPolicyRepository;
  /** 事务内短锁；只序列化当前准入／引用，不跨外部 IO 持锁。 */
  lock(key: string): Promise<void>;
}
export interface UnitOfWork { readonly read: RepositoryScope; run<T>(fn: (scope: RepositoryScope) => Promise<T>): Promise<T> }
