import type {
  ApiOperationDto, ApiProxyDto, ApiRequestDto, CreateApiRequest, DecideApiRequest, SetOpenPolicyRequest,
} from '@crewstation/contracts';
import type { Transport } from '../httpTransport';
import type { ItemsPage } from '../itemsPage';
import { segment } from '../requestUrl';

/** 接口目录：代理与操作、开放策略（管理员）、定向开放申请与审批、裁剪后的 OpenAPI。 */
export interface ApiCatalogResource {
  /** GET /v1/catalog/operations?serviceId=：给出 serviceId 时每条带 granted。 */
  listOperations(query?: { readonly serviceId?: string }): Promise<ItemsPage<ApiOperationDto>>;
  /** GET /v1/catalog/proxies */
  listProxies(): Promise<ItemsPage<ApiProxyDto>>;
  /** GET /v1/catalog/proxies/:proxy/openapi?serviceId=：按该服务可调范围裁剪，servers 指向服务域内部 API 地址。 */
  openapi(proxy: string, query: { readonly serviceId: string }): Promise<Record<string, unknown>>;
  /** PUT /v1/catalog/operations/:key/policy（管理员）；操作键含 `/`，客户端负责编码。 */
  setOpenPolicy(operationKey: string, input: SetOpenPolicyRequest): Promise<ApiOperationDto>;
  /** POST /v1/services/:serviceId/api-requests（201）：为本服务申请定向开放。 */
  requestAccess(serviceId: string, input: CreateApiRequest): Promise<ApiRequestDto>;
  /** GET /v1/api-requests?projectId=：不带 projectId 只有管理员能看全部。 */
  listRequests(query?: { readonly projectId?: string }): Promise<ItemsPage<ApiRequestDto>>;
  /** POST /v1/api-requests/:id/decision（管理员批准或拒绝并给出理由） */
  decideRequest(id: string, input: DecideApiRequest): Promise<ApiRequestDto>;
  /** DELETE /v1/services/:serviceId/grants/:key（204） */
  revokeGrant(serviceId: string, operationKey: string): Promise<void>;
}

export function apiCatalogResource(transport: Transport): ApiCatalogResource {
  return {
    listOperations: (query) => transport.request<ItemsPage<ApiOperationDto>>('GET', '/v1/catalog/operations', { query }),
    listProxies: () => transport.request<ItemsPage<ApiProxyDto>>('GET', '/v1/catalog/proxies'),
    openapi: (proxy, query) => transport.request<Record<string, unknown>>('GET', `/v1/catalog/proxies/${segment(proxy)}/openapi`, { query }),
    setOpenPolicy: (operationKey, input) =>
      transport.request<ApiOperationDto>('PUT', `/v1/catalog/operations/${segment(operationKey)}/policy`, { body: input }),
    requestAccess: (serviceId, input) => transport.request<ApiRequestDto>('POST', `/v1/services/${segment(serviceId)}/api-requests`, { body: input }),
    listRequests: (query) => transport.request<ItemsPage<ApiRequestDto>>('GET', '/v1/api-requests', { query }),
    decideRequest: (id, input) => transport.request<ApiRequestDto>('POST', `/v1/api-requests/${segment(id)}/decision`, { body: input }),
    revokeGrant: (serviceId, operationKey) => transport.request<void>('DELETE', `/v1/services/${segment(serviceId)}/grants/${segment(operationKey)}`),
  };
}
