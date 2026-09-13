import type {
  AddEgressEntryRequest, BlockedEgressDto, DecideEgressRequest, EgressEntryDto, EgressRequestDto, EgressRequestPage, RequestEgressEntryRequest, RequestPageQuery,
} from '@crewstation/contracts';
import type { Transport } from '../httpTransport';
import type { ItemsPage } from '../itemsPage';
import { segment } from '../requestUrl';

/** 用 type 而非 interface：interface 没有隐式索引签名，无法直接作为 `Query` 传给 transport。 */
export type EgressProjectQuery = {
  /** 管理员不带时看全部；带上时（成员亦可）看全局＋该项目。 */
  readonly projectId?: string;
};

/** 出站 FQDN 白名单：管理员维护条目与裁定申请，项目成员申请追加并查看被阻请求。 */
export interface EgressResource {
  /** GET /v1/egress/entries?projectId= */
  listEntries(query?: EgressProjectQuery): Promise<ItemsPage<EgressEntryDto>>;
  /** POST /v1/egress/entries（201，管理员） */
  addEntry(input: AddEgressEntryRequest): Promise<EgressEntryDto>;
  /** DELETE /v1/egress/entries/:id（204，管理员） */
  removeEntry(id: string): Promise<void>;
  /** GET /v1/egress/requests?projectId= */
  listRequests(query?: EgressProjectQuery): Promise<ItemsPage<EgressRequestDto>>;
  listRequestPage(query?: Partial<RequestPageQuery>): Promise<EgressRequestPage>;
  /** GET /v1/projects/:projectId/egress/requests */
  listProjectRequests(projectId: string): Promise<ItemsPage<EgressRequestDto>>;
  /** POST /v1/projects/:projectId/egress/requests（201） */
  requestEntry(projectId: string, input: RequestEgressEntryRequest): Promise<EgressRequestDto>;
  /** POST /v1/egress/requests/:id/decision（管理员；批准即生成项目级条目） */
  decideRequest(id: string, input: DecideEgressRequest): Promise<EgressRequestDto>;
  /** GET /v1/projects/:projectId/egress/blocked */
  listBlocked(projectId: string): Promise<ItemsPage<BlockedEgressDto>>;
}

export function egressResource(transport: Transport): EgressResource {
  const project = (projectId: string) => `/v1/projects/${segment(projectId)}/egress`;
  return {
    listEntries: (query) => transport.request<ItemsPage<EgressEntryDto>>('GET', '/v1/egress/entries', { query }),
    addEntry: (input) => transport.request<EgressEntryDto>('POST', '/v1/egress/entries', { body: input }),
    removeEntry: (id) => transport.request<void>('DELETE', `/v1/egress/entries/${segment(id)}`),
    listRequests: (query) => transport.request<ItemsPage<EgressRequestDto>>('GET', '/v1/egress/requests', { query }),
    listRequestPage: (query) => transport.request<EgressRequestPage>('GET', '/v1/egress/requests/page', { query }),
    listProjectRequests: (projectId) => transport.request<ItemsPage<EgressRequestDto>>('GET', `${project(projectId)}/requests`),
    requestEntry: (projectId, input) => transport.request<EgressRequestDto>('POST', `${project(projectId)}/requests`, { body: input }),
    decideRequest: (id, input) => transport.request<EgressRequestDto>('POST', `/v1/egress/requests/${segment(id)}/decision`, { body: input }),
    listBlocked: (projectId) => transport.request<ItemsPage<BlockedEgressDto>>('GET', `${project(projectId)}/blocked`),
  };
}
