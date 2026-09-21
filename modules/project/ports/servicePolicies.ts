import type { ProjectId, ProjectServicePolicy, UserId } from '@crewstation/contracts';

export interface ServicePolicyRecord {
  projectId: ProjectId;
  policy: ProjectServicePolicy;
  revision: number;
  updatedBy: UserId;
  updatedAt: Date;
}

export interface ServicePolicyRepository {
  get(projectId: ProjectId): Promise<ServicePolicyRecord | undefined>;
  save(record: ServicePolicyRecord, expectedRevision: number): Promise<boolean>;
}
