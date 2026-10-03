/** resource-access 模块对外能力；每个用例在此增加一个方法签名，实现放在 application/。 */
import type { Actor, CreateResourceRequest, DecideResourceRequest, ProjectDeletionOwner, ProjectId, ResourceCatalogPolicy, ResourceRequestDto, ResourceRequestPage, ResourceRequestQuery, ResourceTarget, ResourceTargetInspection, ResourceType, SaveResourceCatalogPolicy } from '@crewstation/contracts';

export interface ResourceAccessModuleApi {
  readonly name: 'resource-access';
  readonly deletionOwner?: ProjectDeletionOwner;
  /** Internal original ID facts only; opaque history is never inferred from a resource name. */
  originalInfrastructureOwnership(key: string, representation?: 'current' | 'legacy'): Promise<{ complete: true; id: string; scope: 'project'; projectIds: readonly ProjectId[]; revision: string } | undefined>;
  create(actor: Actor, projectId: ProjectId, input: CreateResourceRequest): Promise<ResourceRequestDto>;
  direct(actor: Actor, projectId: ProjectId, input: CreateResourceRequest): Promise<ResourceRequestDto>;
  decide(actor: Actor, projectId: ProjectId, id: string, input: DecideResourceRequest): Promise<ResourceRequestDto>;
  cancel(actor: Actor, projectId: ProjectId, id: string, expectedVersion: number): Promise<ResourceRequestDto>;
  retry(actor: Actor, projectId: ProjectId, id: string, expectedVersion: number): Promise<ResourceRequestDto>;
  get(actor: Actor, projectId: ProjectId, id: string): Promise<ResourceRequestDto>;
  list(actor: Actor, projectId: ProjectId, query: ResourceRequestQuery): Promise<ResourceRequestPage>;
  inspect(actor: Actor, projectId: ProjectId, target: ResourceTarget): Promise<ResourceTargetInspection>;
  targets(actor: Actor, projectId: ProjectId, type: ResourceType): Promise<ResourceTargetInspection[]>;
  saveCatalogPolicy(actor: Actor, projectId: ProjectId, target: ResourceTarget, input: SaveResourceCatalogPolicy): Promise<ResourceCatalogPolicy>;
}
