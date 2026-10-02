import type { CreateRuntimeImageSetup, ProjectRuntimeImagePolicyDto, SaveProjectRuntimeImagePolicy, RuntimeImageGrants, RuntimeImageCatalogEntryDto } from '@crewstation/contracts';
import type { RuntimeImageHistoryQuery, RuntimeImageHistoryPage } from '@crewstation/contracts';
import type {
  SaveDevelopmentRuntimeImages, Actor, CreateRuntimeImageRequest, CreateRuntimeImageRevision, RuntimeImageBuildDto, RuntimeImageDto, RuntimeImageLogPage, RuntimeImageLogQuery,
  RuntimeImagePageQuery, RuntimeImageRevisionDto, RuntimeImageVersionDto, StartRuntimeImageBuild, UpdateRuntimeImageRequest, StartImageValidation, RuntimeImageValidationDto,
} from '@crewstation/contracts';
import type { RuntimeImageBindings, ImageReferenceView } from './bindings';
import type { ProjectDeletionOwner, ResourceTarget, ResourceValues } from '@crewstation/contracts';

/** 运行镜像目录与构建；用途验证结果单独管理，不把构建成功当成可执行。 */
export interface RuntimeEnvironmentModuleApi extends RuntimeImageBindings {
  /** Internal owner is available only with callback admission, deletion grant and independent physical source. */
  readonly deletionOwner?: ProjectDeletionOwner;
  applyResourceChange(actor: Actor, projectId: string, input: { operationId: string; target: ResourceTarget; expectedRevision: string; values: ResourceValues }): Promise<{ revision: string; effect: string; applied: boolean }>;
  resourceChangeReceipt(projectId: string, operationId: string): Promise<{ revision: string; effect: string; applied: boolean } | undefined>;
  imageGrants(actor: Actor, imageId: string): Promise<RuntimeImageGrants>;
  getProjectImagePolicy(actor: Actor, projectId: string): Promise<ProjectRuntimeImagePolicyDto>;
  saveProjectImagePolicy(actor: Actor, projectId: string, input: SaveProjectRuntimeImagePolicy): Promise<ProjectRuntimeImagePolicyDto>;
  createSetup(actor: Actor, projectId: string | undefined, input: CreateRuntimeImageSetup): Promise<{ image: RuntimeImageDto; revision: RuntimeImageRevisionDto }>;
  imageHistory(actor: Actor, projectId: string | undefined, imageId: string, query: RuntimeImageHistoryQuery): Promise<RuntimeImageHistoryPage>;
  readonly name: 'runtime-environment';
  getDevelopmentImages(actor: Actor, projectId: string): Promise<Omit<SaveDevelopmentRuntimeImages, 'expectedRevision'> & { projectId: string; revision: number }>;
  saveDevelopmentImages(actor: Actor, projectId: string, input: SaveDevelopmentRuntimeImages): Promise<Omit<SaveDevelopmentRuntimeImages, 'expectedRevision'> & { projectId: string; revision: number }>;
  /** 控制面工作器内部入口，HTTP 不暴露。 */
  reconcileReferences(): Promise<number>;
  reconcileValidations(): Promise<void>;
  runValidation(validationId: string): Promise<void>;
  cancelValidation(actor: Actor, projectId: string | undefined, versionId: string, validationId: string, requestKey: string): Promise<RuntimeImageValidationDto>;
  reconcileBuilds(): Promise<void>;
  runBuild(buildId: string): Promise<void>;
  adminCatalog(actor: Actor, page: RuntimeImagePageQuery): Promise<RuntimeImageCatalogEntryDto[]>;
  listImages(actor: Actor, projectId: string, page: RuntimeImagePageQuery): Promise<RuntimeImageDto[]>;
  getImage(actor: Actor, projectId: string | undefined, imageId: string): Promise<RuntimeImageDto>;
  createImage(actor: Actor, projectId: string | undefined, input: CreateRuntimeImageRequest): Promise<RuntimeImageDto>;
  updateImage(actor: Actor, projectId: string | undefined, imageId: string, input: UpdateRuntimeImageRequest): Promise<RuntimeImageDto>;
  shareImage(actor: Actor, projectId: string, imageId: string, scope: 'project' | 'shared', expectedRevision: number): Promise<RuntimeImageDto>;
  createRevision(actor: Actor, projectId: string | undefined, imageId: string, input: CreateRuntimeImageRevision): Promise<RuntimeImageRevisionDto>;
  listRevisions(actor: Actor, projectId: string | undefined, imageId: string, page: RuntimeImagePageQuery): Promise<RuntimeImageRevisionDto[]>;
  listVersions(actor: Actor, projectId: string | undefined, imageId: string, page: RuntimeImagePageQuery): Promise<RuntimeImageVersionDto[]>;
  startBuild(actor: Actor, projectId: string | undefined, imageId: string, input: StartRuntimeImageBuild): Promise<RuntimeImageBuildDto>;
  getBuild(actor: Actor, projectId: string | undefined, imageId: string, buildId: string): Promise<RuntimeImageBuildDto>;
  listBuilds(actor: Actor, projectId: string | undefined, imageId: string, page: RuntimeImagePageQuery): Promise<RuntimeImageBuildDto[]>;
  cancelBuild(actor: Actor, projectId: string | undefined, imageId: string, buildId: string, requestKey: string): Promise<RuntimeImageBuildDto>;
  buildLogs(actor: Actor, projectId: string | undefined, imageId: string, buildId: string, query: RuntimeImageLogQuery): Promise<({ expired: false } & RuntimeImageLogPage) | { expired: true; expiresAt: string }>;
  getVersion(actor: Actor, projectId: string | undefined, versionId: string): Promise<RuntimeImageVersionDto>;
  disableVersion(actor: Actor, projectId: string | undefined, versionId: string): Promise<RuntimeImageVersionDto>;
  versionReferences(actor: Actor, projectId: string | undefined, versionId: string): Promise<{ items: ImageReferenceView[]; total: number }>;
  retireVersion(actor: Actor, projectId: string | undefined, versionId: string): Promise<{ version: RuntimeImageVersionDto; physicalDeletion: 'retained' | 'pending-maintenance' }>;
  startValidation(actor: Actor, projectId: string, versionId: string, input: StartImageValidation): Promise<RuntimeImageValidationDto>;
  getValidation(actor: Actor, projectId: string | undefined, versionId: string, validationId: string): Promise<RuntimeImageValidationDto>;
  listValidations(actor: Actor, projectId: string | undefined, versionId: string): Promise<RuntimeImageValidationDto[]>;
}
