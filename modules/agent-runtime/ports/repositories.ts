import type { ProjectComputePolicyRecord } from '../domain/projectComputePolicy';
import type { ProfileTestId, ProjectId, UserId } from '@crewstation/contracts';
import type { ComputeProfile, ProfileCredential, ProfileRevision } from '../domain/computeProfile';
import type { ProfileTest } from '../domain/profileTest';

export interface ProfileRepository {
  insert(profile: ComputeProfile): Promise<void>;
  update(profile: ComputeProfile): Promise<void>;
  get(name: string): Promise<ComputeProfile | undefined>;
  /** 事务内锁住档位行，串行化保存、启用、设默认与删除。 */
  lock(name: string): Promise<ComputeProfile | undefined>;
  getDefault(): Promise<ComputeProfile | undefined>;
  list(): Promise<ComputeProfile[]>;
  remove(name: string): Promise<void>;
  /** 设默认前清掉旧默认（部分唯一索引保证全平台至多一个）。 */
  clearDefault(): Promise<void>;
}

export interface RevisionRepository {
  insert(revision: ProfileRevision): Promise<void>;
  get(profile: string, revision: number): Promise<ProfileRevision | undefined>;
  removeAll(profile: string): Promise<void>;
}

export interface CredentialRepository {
  list(profile: string): Promise<ProfileCredential[]>;
  upsert(credential: ProfileCredential): Promise<void>;
  remove(profile: string, id: string, updatedBy: UserId, updatedAt: Date): Promise<void>;
  removeAll(profile: string): Promise<void>;
}

export interface TestRepository {
  insert(test: ProfileTest): Promise<void>;
  update(test: ProfileTest): Promise<void>;
  get(testId: ProfileTestId): Promise<ProfileTest | undefined>;
  findByRequest(profile: string, createdBy: UserId, clientRequestId: string): Promise<ProfileTest | undefined>;
  /** 某修订的最近一次测试（任何状态）。 */
  latestFor(profile: string, revision: number): Promise<ProfileTest | undefined>;
  /** 新修订产生时，旧修订上还没结束的测试作废。 */
  supersedeBefore(profile: string, revision: number, at: Date): Promise<void>;
  removeAll(profile: string): Promise<void>;
}

export const PROFILE_TEST_JOB_KIND = 'agent-runtime.profile-test';

export interface ProjectPolicyRepository {
  get(projectId: ProjectId): Promise<ProjectComputePolicyRecord | undefined>;
  save(record: ProjectComputePolicyRecord, expectedRevision: number): Promise<boolean>;
  referencing(name: string): Promise<ProjectId[]>;
}
