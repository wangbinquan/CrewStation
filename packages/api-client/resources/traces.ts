import type { TraceChainDto, TraceEventDto, TraceSource, TraceStatus, TraceSummaryDto, TraceWindow } from '@crewstation/contracts';
import type { Transport } from '../httpTransport';
import type { ItemsPage } from '../itemsPage';
import { segment } from '../requestUrl';

/** 列表查询：来源、状态、按有活动算的时间范围、上一页给的游标与每页条数；都可省。 */
export interface TraceListInput { readonly source?: TraceSource; readonly status?: TraceStatus; readonly window?: TraceWindow; readonly cursor?: string; readonly limit?: number }

/** 调用链（Design §14）：本项目的链列表、一条链的分层回放、一个 Agent 执行的事件分页。只含本项目的记录。 */
export interface TracesResource {
  /** GET /v1/projects/:projectId/traces?source=&status=&window=&cursor=&limit= */
  list(projectId: string, query?: TraceListInput): Promise<ItemsPage<TraceSummaryDto>>;
  /** GET /v1/projects/:projectId/traces/:traceId；本项目没有这条链时 404。 */
  get(projectId: string, traceId: string): Promise<TraceChainDto>;
  /** GET /v1/projects/:projectId/traces/:traceId/executions/:taskId/events?cursor=&limit= */
  events(projectId: string, traceId: string, taskId: string, query?: { cursor?: string; limit?: number }): Promise<ItemsPage<TraceEventDto>>;
}

export function tracesResource(transport: Transport): TracesResource {
  const traces = (projectId: string) => `/v1/projects/${segment(projectId)}/traces`;
  return {
    list: (projectId, query = {}) => transport.request('GET', traces(projectId), { query: { ...query } }),
    get: (projectId, traceId) => transport.request('GET', `${traces(projectId)}/${segment(traceId)}`),
    events: (projectId, traceId, taskId, query = {}) => transport.request('GET', `${traces(projectId)}/${segment(traceId)}/executions/${segment(taskId)}/events`, { query: { ...query } }),
  };
}
