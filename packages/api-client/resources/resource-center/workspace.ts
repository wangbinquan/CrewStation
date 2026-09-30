import type { CreateResourceRequest, DecideResourceRequest, ProjectResourceSnapshot, ResourceCatalogPolicy, ResourceRequestDto, ResourceRequestPage, ResourceRequestQuery, ResourceTarget, ResourceTargetInspection, ResourceType, SaveResourceCatalogPolicy } from '@crewstation/contracts';
import type { Transport } from '../../httpTransport';
import { segment } from '../../requestUrl';

export interface ProjectResourceCenterResource {
  snapshot(projectId: string): Promise<ProjectResourceSnapshot>;
  requests(projectId: string, page?: Partial<ResourceRequestQuery>): Promise<ResourceRequestPage>;
  request(projectId: string, id: string): Promise<ResourceRequestDto>;
  inspect(projectId: string, target: ResourceTarget): Promise<ResourceTargetInspection>;
  targets(projectId: string, type: ResourceType): Promise<ResourceTargetInspection[]>;
  create(projectId: string, input: CreateResourceRequest): Promise<ResourceRequestDto>;
  direct(projectId: string, input: CreateResourceRequest): Promise<ResourceRequestDto>;
  decide(projectId: string, id: string, input: DecideResourceRequest): Promise<ResourceRequestDto>;
  cancel(projectId: string, id: string, expectedVersion: number): Promise<ResourceRequestDto>;
  retry(projectId: string, id: string, expectedVersion: number): Promise<ResourceRequestDto>;
  saveCatalogPolicy(projectId: string, target: ResourceTarget, policy: SaveResourceCatalogPolicy): Promise<ResourceCatalogPolicy>;
}
export function projectResourceCenterResource(t: Transport): ProjectResourceCenterResource {
  const root = (id: string) => `/v1/projects/${segment(id)}/resource-center`, request = (p: string, id: string) => `${root(p)}/requests/${segment(id)}`;
  return { snapshot: (p) => t.request('GET', root(p)), requests: (p, page) => t.request('GET', `${root(p)}/requests`, { query: page }), request: (p, id) => t.request('GET', request(p, id)), inspect: (p, target) => t.request('POST', `${root(p)}/inspect`, { body: target }), targets: (p, type) => t.request('GET', `${root(p)}/targets/${segment(type)}`),
    create: (p, body) => t.request('POST', `${root(p)}/requests`, { body }), direct: (p, body) => t.request('POST', `${root(p)}/direct`, { body }), decide: (p, id, body) => t.request('POST', `${request(p, id)}/decision`, { body }), cancel: (p, id, expectedVersion) => t.request('POST', `${request(p, id)}/cancel`, { body: { expectedVersion } }), retry: (p, id, expectedVersion) => t.request('POST', `${request(p, id)}/retry`, { body: { expectedVersion } }), saveCatalogPolicy: (p, target, policy) => t.request('PUT', `${root(p)}/catalog-policy`, { body: { target, policy } }),
  };
}
