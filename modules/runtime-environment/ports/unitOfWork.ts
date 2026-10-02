import type { ProjectRuntimeImagePolicyDto } from '@crewstation/contracts';
import type { ImageAllocationReceipt } from '../domain/allocation';
import type { BuildRepository, DevelopmentPolicyRepository, ImageRepository, LogRepository, ReferenceRepository, RevisionRepository, RuntimeImageProjectContent, ValidationRepository, VersionRepository } from './repositories';

export interface RepositoryScope {
  /** No UI page limit; reports unknown schema or conflicting ownership instead of treating it as empty. */
  projectContent(projectId: string): Promise<RuntimeImageProjectContent>;
  readonly allocationReceipts: {
    get(projectId: string, operationId: string): Promise<ImageAllocationReceipt | undefined>;
    save(projectId: string, operationId: string, receipt: ImageAllocationReceipt): Promise<void>;
  };
  readonly projectImagePolicies: {
    get(projectId: string): Promise<ProjectRuntimeImagePolicyDto | undefined>;
    save(policy: ProjectRuntimeImagePolicyDto): Promise<void>;
  };
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

/** The original platform process is protected before a callback starts; lease/connection expiry is not an exit. */
export interface RuntimeImageCallbackProcess {
  readonly podUid: string; readonly containerId: string; readonly nodeUid: string; readonly nodeName: string;
}
export interface RuntimeImageCallback {
  readonly kind: 'build' | 'validation' | 'source' | 'initializer'; readonly id: string; readonly inputDigest: string;
}
export interface RuntimeImageProjectAdmissions {
  run<T>(projectIds: readonly string[], callback: RuntimeImageCallback, work: () => Promise<T>): Promise<T>;
  assertActive(projectIds: readonly string[]): void;
  check(projectIds: readonly string[]): Promise<void>;
}
