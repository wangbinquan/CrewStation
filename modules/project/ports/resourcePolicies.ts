import type { ProjectId, ProjectNamespaceQuotaDto } from '@crewstation/contracts';

export interface ResourcePolicyReceipt { hash: string; revision: string; effect: string; applied: boolean }
export interface ProjectResourcePolicies {
  namespace(projectId: ProjectId): Promise<ProjectNamespaceQuotaDto | undefined>;
  saveNamespace(record: ProjectNamespaceQuotaDto, expectedRevision: number, actorId: string): Promise<boolean>;
  receipt(operationId: string, projectId: ProjectId): Promise<ResourcePolicyReceipt | undefined>;
  saveReceipt(operationId: string, projectId: ProjectId, receipt: ResourcePolicyReceipt): Promise<void>;
  lock(projectId: ProjectId): Promise<void>;
}
