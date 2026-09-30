import type { Actor, LegacyResourceRequest, ProjectDto, ProjectId, ProjectResourceEdge, ProjectResourceNode, ResourceRequestPage, ResourceTargetInspection, ResourceType } from '@crewstation/contracts';

export interface ProjectResourceFragment { nodes: ProjectResourceNode[]; edges: ProjectResourceEdge[]; complete?: boolean; message?: string }
export interface ProjectResourceSource { id: string; name: string; load(actor: Actor, projectId: ProjectId): Promise<ProjectResourceFragment> }
export interface ResourceCenterSources {
  authorize(actor: Actor, projectId: ProjectId, action: 'view'): Promise<string>;
  project(actor: Actor, projectId: ProjectId): Promise<ProjectDto>;
  targets(actor: Actor, projectId: ProjectId, type: ResourceType): Promise<ResourceTargetInspection[]>;
  requests(actor: Actor, projectId: ProjectId): Promise<ResourceRequestPage>;
  activeRequests(actor: Actor, projectId: ProjectId): Promise<ResourceRequestPage>;
  legacyRequests(actor: Actor, projectId: ProjectId): Promise<LegacyResourceRequest[]>;
  sources: ProjectResourceSource[];
}
