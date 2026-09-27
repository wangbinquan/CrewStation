import type { BuildRepository, DevelopmentPolicyRepository, ImageRepository, LogRepository, ReferenceRepository, RevisionRepository, ValidationRepository, VersionRepository } from './repositories';

export interface RepositoryScope {
  readonly creations: {
    get(projectId: string, actorId: string, requestKey: string): Promise<{ fingerprint: string; imageId: string; revisionId: string } | undefined>;
    insert(input: { projectId: string; actorId: string; requestKey: string; fingerprint: string; imageId: string; revisionId: string }): Promise<void>;
  };
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
