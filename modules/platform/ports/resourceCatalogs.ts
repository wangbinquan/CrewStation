import type { Actor, ApiOperationDto, ApiRequestDto, ComputeProfileList, NamespaceQuota, ObjectSpaceDto, ObjectStoragePlanDto, ProjectComputePolicyDto, ProjectId, ProjectNamespaceQuotaDto, ProjectRateLimitsDto, ProjectRuntimeImagePolicyDto, ProjectServicePolicyDto, QuotaDto, RateLimitSettingsDto, ResourceTarget, ResourceTargetDescription, ResourceType, ResourceValues, RuntimeImageDto, ServiceId, ServicePlanDto, TaskId, TaskProfileDto, UserId } from '@crewstation/contracts';

export interface ResourceCommand { operationId: string; actor: Actor; projectId: ProjectId; target: ResourceTarget; expectedRevision: string; values: ResourceValues; requestedBy: UserId; reason: string }
export interface ResourceReceipt { revision: string; effect: string; applied: boolean }
export interface ResourceCatalogAdapter {
  resourceType: ResourceType; list(projectId: ProjectId): Promise<ResourceTargetDescription[]>; read(projectId: ProjectId, target: ResourceTarget): Promise<ResourceTargetDescription>;
  apply(command: ResourceCommand): Promise<ResourceReceipt>; recover?(projectId: ProjectId, id: string): Promise<ResourceReceipt | undefined>;
  observe?(projectId: ProjectId, target: ResourceTarget, receipt: ResourceReceipt, operationId: string): Promise<{ applied: boolean; effect: string }>;
}
type Apply = (actor: Actor, id: ProjectId, input: Omit<ResourceCommand, 'actor' | 'projectId' | 'requestedBy' | 'reason'>) => Promise<ResourceReceipt>;
type Recover = (projectId: ProjectId, id: string) => Promise<ResourceReceipt | undefined>;
export interface ResourceCatalogPorts {
  actor: Actor;
  project: {
    listServicePlans(): Promise<ServicePlanDto[]>; listTaskProfiles(): Promise<TaskProfileDto[]>;
    getServicePolicy(actor: Actor, id: ProjectId): Promise<ProjectServicePolicyDto>; getQuota(actor: Actor, id: ProjectId): Promise<QuotaDto>; getNamespaceQuota(actor: Actor, id: ProjectId): Promise<ProjectNamespaceQuotaDto>;
    applyResourceChange: Apply; resourceChangeReceipt: Recover;
    resolveServiceOfProject(id: ProjectId): Promise<{ serviceId: ServiceId; namespace: string; identity: string } | undefined>;
  };
  compute: { listProfiles(actor: Actor): Promise<ComputeProfileList>; getProjectComputePolicy(actor: Actor, id: ProjectId): Promise<ProjectComputePolicyDto>; applyResourceChange: Apply; resourceChangeReceipt: Recover };
  images: { adminCatalog(actor: Actor, page: { limit: number; before?: string }): Promise<RuntimeImageDto[]>; listImages(actor: Actor, id: string, page: { limit: number; before?: string }): Promise<RuntimeImageDto[]>; getProjectImagePolicy(actor: Actor, id: string): Promise<ProjectRuntimeImagePolicyDto>; applyResourceChange: Apply; resourceChangeReceipt: Recover };
  objects?: { plans(actor: Actor): Promise<ObjectStoragePlanDto[]>; projectPolicy(actor: Actor, id: ProjectId): Promise<{ revision: number; planIds: readonly string[] }>; spaces(actor: Actor, id: ProjectId): Promise<ObjectSpaceDto[]>; applyResourceChange: Apply; resourceChangeReceipt: Recover };
  api: { listRequests(actor: Actor, id: ProjectId): Promise<ApiRequestDto[]>; listOperations(actor: Actor, id: ServiceId): Promise<ApiOperationDto[]>; applyResourceChange: (actor: Actor, id: ServiceId, input: Omit<ResourceCommand, 'actor' | 'projectId' | 'requestedBy' | 'reason'>) => Promise<ResourceReceipt>; resourceChangeReceipt(id: ServiceId, operationId: string): Promise<ResourceReceipt | undefined> };
  gateway: { getRateLimits(actor: Actor): Promise<RateLimitSettingsDto>; getProjectRateLimits(actor: Actor, id: ProjectId): Promise<ProjectRateLimitsDto>; applyResourceChange: Apply; resourceChangeReceipt: Recover };
  production: { listProductionAccessTargets(actor: Actor, id: ProjectId): Promise<ResourceTargetDescription[]>; inspectProductionAccess(actor: Actor, id: ProjectId, task: TaskId): Promise<ResourceTargetDescription>; applyProductionAccess(actor: Actor, id: ProjectId, input: { operationId: string; taskId: TaskId; expectedRevision: string; values: ResourceValues; requestedBy: UserId; reason: string }): Promise<ResourceReceipt>; productionAccessReceipt: Recover; observeProductionAccess(id: ProjectId, operationId: string): Promise<ResourceReceipt> };
  revisions: {
    service(revision: number, plan: ServicePlanDto): string; namespace(revision: number, quota: NamespaceQuota): string; execution(limit: number): string;
    compute(revision: number, profile: { id: string; revision: number; enabled: boolean; defaultVisible?: boolean }): string; task(revision: number, id: string): string;
    image(revision: number, image: RuntimeImageDto): string; objectPlan(revision: number, plan: ObjectStoragePlanDto): string; objectSpace(space: ObjectSpaceDto): string;
    api(operation: ApiOperationDto, granted: boolean): string; gateway(value: ProjectRateLimitsDto, revision: number): string; gatewayValues(value: ProjectRateLimitsDto['effective']): ResourceValues;
  };
  reapplyNamespace(id: ProjectId): Promise<void>;
  observeNamespace(id: ProjectId, receipt: ResourceReceipt): Promise<{ applied: boolean; effect: string }>;
  observeGateway(id: ProjectId, receipt: ResourceReceipt): Promise<{ applied: boolean; effect: string }>;
  observeApi(id: ProjectId, target: ResourceTarget): Promise<{ applied: boolean; effect: string }>;
}
