import type { ProjectComputePolicy, ProjectId, UserId } from '@crewstation/contracts';

export interface ProjectComputePolicyRecord {
  projectId: ProjectId;
  revision: number;
  policy: ProjectComputePolicy;
  updatedBy: UserId;
  updatedAt: Date;
}

export const INHERITED_COMPUTE_POLICY: ProjectComputePolicy = { mode: 'inherit', allowedProfiles: [], defaultProfile: null, devTaskProfile: null };
