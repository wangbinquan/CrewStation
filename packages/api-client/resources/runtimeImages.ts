import type { CreateRuntimeImageSetup } from '@crewstation/contracts';
import type { RuntimeImageHistoryQuery, RuntimeImageHistoryPage } from '@crewstation/contracts';
import type { CreateRuntimeImageRequest, CreateRuntimeImageRevision, RuntimeImageBuildDto, RuntimeImageDto, RuntimeImageLogPage, RuntimeImagePageQuery, RuntimeImageRevisionDto, RuntimeImageVersionDto, RuntimeImageValidationDto, SaveDevelopmentRuntimeImages, StartImageValidation, StartRuntimeImageBuild, UpdateRuntimeImageRequest } from '@crewstation/contracts';
import type { Transport } from '../httpTransport';
import type { RuntimeImageReferenceDto, RuntimeImageOptionDto } from '@crewstation/contracts';
import type { ItemsPage } from '../itemsPage';
import { segment } from '../requestUrl';

export type DevelopmentRuntimeImages = Omit<SaveDevelopmentRuntimeImages, 'expectedRevision'> & { projectId: string; revision: number };
export interface RuntimeImagesResource {
  createSetup(projectId: string, input: CreateRuntimeImageSetup): Promise<{ image: RuntimeImageDto; revision: RuntimeImageRevisionDto }>;
  history(projectId: string, imageId: string, page?: Partial<RuntimeImageHistoryQuery>): Promise<RuntimeImageHistoryPage>;
  adminCatalog(page?: Partial<RuntimeImagePageQuery>): Promise<ItemsPage<RuntimeImageDto>>;
  list(projectId: string, page?: Partial<RuntimeImagePageQuery>): Promise<ItemsPage<RuntimeImageDto>>;
  create(projectId: string, input: CreateRuntimeImageRequest): Promise<RuntimeImageDto>;
  get(projectId: string, imageId: string): Promise<RuntimeImageDto>;
  update(projectId: string, imageId: string, input: UpdateRuntimeImageRequest): Promise<RuntimeImageDto>;
  share(projectId: string, imageId: string, scope: 'project' | 'shared', expectedRevision: number): Promise<RuntimeImageDto>;
  createRevision(projectId: string, imageId: string, input: CreateRuntimeImageRevision): Promise<RuntimeImageRevisionDto>;
  revisions(projectId: string, imageId: string, page?: Partial<RuntimeImagePageQuery>): Promise<ItemsPage<RuntimeImageRevisionDto>>;
  versions(projectId: string, imageId: string, page?: Partial<RuntimeImagePageQuery>): Promise<ItemsPage<RuntimeImageVersionDto>>;
  startBuild(projectId: string, imageId: string, input: StartRuntimeImageBuild): Promise<RuntimeImageBuildDto>;
  builds(projectId: string, imageId: string, page?: Partial<RuntimeImagePageQuery>): Promise<ItemsPage<RuntimeImageBuildDto>>;
  build(projectId: string, imageId: string, buildId: string): Promise<RuntimeImageBuildDto>;
  cancelBuild(projectId: string, imageId: string, buildId: string, requestKey: string): Promise<RuntimeImageBuildDto>;
  logs(projectId: string, imageId: string, buildId: string, after?: number): Promise<{ expired: false } & RuntimeImageLogPage>;
  validate(projectId: string, imageId: string, versionId: string, input: StartImageValidation): Promise<RuntimeImageValidationDto>;
  validations(projectId: string, imageId: string, versionId: string): Promise<ItemsPage<RuntimeImageValidationDto>>;
  cancelValidation(projectId: string, imageId: string, versionId: string, validationId: string, requestKey: string): Promise<RuntimeImageValidationDto>;
  disable(projectId: string, imageId: string, versionId: string): Promise<RuntimeImageVersionDto>;
  retire(projectId: string, imageId: string, versionId: string): Promise<{ version: RuntimeImageVersionDto; physicalDeletion: 'retained' | 'pending-maintenance' }>;
  references(projectId: string, imageId: string, versionId: string): Promise<{ items: RuntimeImageReferenceDto[]; total: number }>;
  version(projectId: string, versionId: string): Promise<RuntimeImageOptionDto>;
  development(projectId: string): Promise<DevelopmentRuntimeImages>;
  saveDevelopment(projectId: string, input: SaveDevelopmentRuntimeImages): Promise<DevelopmentRuntimeImages>;
}

export function runtimeImagesResource(t: Transport): RuntimeImagesResource {
  const root = (project: string) => `/v1/projects/${segment(project)}/runtime-images`;
  const image = (project: string, id: string) => `${root(project)}/${segment(id)}`;
  const build = (project: string, id: string, buildId: string) => `${image(project, id)}/builds/${segment(buildId)}`;
  const version = (project: string, id: string, versionId: string) => `${image(project, id)}/versions/${segment(versionId)}`;
  const development = (project: string) => `/v1/projects/${segment(project)}/development-runtime-images`;
  return {
    createSetup: (p, input) => t.request('POST', `${root(p)}/setup`, { body: input }),
    history: (p, id, page) => t.request('GET', `${image(p, id)}/history`, { query: page }),
    adminCatalog: (page) => t.request('GET', '/v1/admin/runtime-image-catalog', { query: page }),
    list: (p, page) => t.request('GET', root(p), { query: page }), create: (p, input) => t.request('POST', root(p), { body: input }),
    get: (p, id) => t.request('GET', image(p, id)), update: (p, id, input) => t.request('PATCH', image(p, id), { body: input }),
    share: (p, id, scope, expectedRevision) => t.request('POST', `${image(p, id)}/share`, { body: { scope, expectedRevision } }),
    createRevision: (p, id, input) => t.request('POST', `${image(p, id)}/revisions`, { body: input }),
    revisions: (p, id, page) => t.request('GET', `${image(p, id)}/revisions`, { query: page }), versions: (p, id, page) => t.request('GET', `${image(p, id)}/versions`, { query: page }),
    startBuild: (p, id, input) => t.request('POST', `${image(p, id)}/builds`, { body: input }), builds: (p, id, page) => t.request('GET', `${image(p, id)}/builds`, { query: page }),
    build: (p, id, b) => t.request('GET', build(p, id, b)), cancelBuild: (p, id, b, requestKey) => t.request('POST', `${build(p, id, b)}/cancel`, { body: { requestKey } }),
    logs: (p, id, b, after = 0) => t.request('GET', `${build(p, id, b)}/logs`, { query: { after } }),
    validate: (p, id, v, input) => t.request('POST', `${version(p, id, v)}/validations`, { body: input }), validations: (p, id, v) => t.request('GET', `${version(p, id, v)}/validations`),
    cancelValidation: (p, id, v, validation, requestKey) => t.request('POST', `${version(p, id, v)}/validations/${segment(validation)}/cancel`, { body: { requestKey } }),
    disable: (p, id, v) => t.request('POST', `${version(p, id, v)}/disable`), retire: (p, id, v) => t.request('DELETE', version(p, id, v)),
    references: (p, id, v) => t.request('GET', `${version(p, id, v)}/references`),
    version: (p, v) => t.request('GET', `/v1/projects/${segment(p)}/runtime-image-versions/${segment(v)}`),
    development: (p) => t.request('GET', development(p)), saveDevelopment: (p, input) => t.request('PUT', development(p), { body: input }),
  };
}
