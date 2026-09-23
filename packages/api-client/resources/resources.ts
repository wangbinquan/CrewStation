import type { AdminResourceViewQuery, AdoptionReport, ResourceActionId, ResourceActionRequest, ResourceActionResult, ResourceView, ResourceViewQuery } from '@crewstation/contracts';
import type { Transport } from '../httpTransport';
import { buildUrl, segment } from '../requestUrl';

/** RFC-025 标准资源视图：快照、推送流地址、可做操作；管理员另有全平台视图与收编空跑报告。 */
export interface ResourcesResource {
  /** GET /v1/projects/:projectId/resources?kind=&parent=&includeStopped= */
  view(projectId: string, query?: ResourceViewQuery): Promise<ResourceView>;
  /** `GET /v1/projects/:projectId/resources/stream` 的 SSE 地址；续传游标走查询参数（EventSource 带不了 Last-Event-ID 以外的头，重连时浏览器自己带它）。 */
  streamUrl(projectId: string, query?: ResourceViewQuery & { cursor?: number }): string;
  /** POST /v1/resources/:resourceId/actions/:action（202）。 */
  act(resourceId: string, action: ResourceActionId, body?: ResourceActionRequest): Promise<ResourceActionResult>;
  /** GET /v1/admin/resources（仅管理员）。 */
  adminView(query?: AdminResourceViewQuery): Promise<ResourceView>;
  adminStreamUrl(query?: AdminResourceViewQuery & { cursor?: number }): string;
  /** GET /v1/admin/resources/adoption-report（仅管理员；只读的收编空跑）。 */
  adoptionReport(): Promise<AdoptionReport>;
}

export function resourcesResource(transport: Transport): ResourcesResource {
  const project = (projectId: string) => `/v1/projects/${segment(projectId)}/resources`;
  return {
    view: (projectId, query = {}) => transport.request('GET', project(projectId), { query: { ...query } }),
    streamUrl: (projectId, query = {}) => buildUrl(transport.baseUrl, `${project(projectId)}/stream`, { ...query }),
    act: (resourceId, action, body = {}) => transport.request('POST', `/v1/resources/${segment(resourceId)}/actions/${segment(action)}`, { body }),
    adminView: (query = {}) => transport.request('GET', '/v1/admin/resources', { query: { ...query } }),
    adminStreamUrl: (query = {}) => buildUrl(transport.baseUrl, '/v1/admin/resources/stream', { ...query }),
    adoptionReport: () => transport.request('GET', '/v1/admin/resources/adoption-report'),
  };
}
