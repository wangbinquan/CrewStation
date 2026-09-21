import type { ClusterCapacity, ClusterNode, ClusterNodesPage, ClusterObservationQuery, ClusterUsagePage, ClusterUsageQuery, ClusterHistory, ClusterHistoryQuery, ClusterHistoryResources, ClusterHistoryResourcesQuery } from '@crewstation/contracts';
import type { ClusterSummary, ClusterFilter, ClusterPage, ClusterDetail, ClusterEvents, ClusterLogs, ClusterLogsQuery, ClusterInspection, ClusterInspectRequest, ClusterOperation, ClusterOperationRequest, ClusterOperationQuery } from '@crewstation/contracts';
import type { Transport } from '../httpTransport';
import { segment } from '../requestUrl';
export function clusterResource(transport: Transport) {
  const base = '/v1/admin/cluster', resource = (id: string) => `${base}/resources/${segment(id)}`;
  return {
    capacity: () => transport.request<ClusterCapacity>('GET', `${base}/capacity`),
    nodes: (query: Partial<ClusterObservationQuery> = {}) => transport.request<ClusterNodesPage>('GET', `${base}/nodes`, { query }),
    node: (id: string, observationId?: string) => transport.request<ClusterNode>('GET', `${base}/nodes/${segment(id)}`, { query: { observationId } }),
    usage: (query: Partial<ClusterUsageQuery> = {}) => transport.request<ClusterUsagePage>('GET', `${base}/usage`, { query: { ...query, resourceIds: query.resourceIds?.join(',') } }),
    history: (query: ClusterHistoryQuery) => transport.request<ClusterHistory>('GET', `${base}/history`, { query: { ...query, metrics: query.metrics.join(',') } }),
    historyResources: (query: Partial<ClusterHistoryResourcesQuery> = {}) => transport.request<ClusterHistoryResources>('GET', `${base}/history/resources`, { query }),
    summary: (query: Partial<ClusterFilter> = {}) => transport.request<ClusterSummary>('GET', `${base}/summary`, { query }),
    resources: (query: Partial<ClusterFilter> = {}) => transport.request<ClusterPage>('GET', `${base}/resources`, { query }),
    detail: (id: string, snapshotId?: string) => transport.request<ClusterDetail>('GET', resource(id), { query: { snapshotId } }),
    events: (id: string) => transport.request<ClusterEvents>('GET', `${resource(id)}/events`),
    logs: (id: string, query: ClusterLogsQuery) => transport.request<ClusterLogs>('GET', `${resource(id)}/logs`, { query }),
    refresh: () => transport.request<{ refreshId: string }>('POST', `${base}/refresh`),
    inspect: (id: string, body: ClusterInspectRequest) => transport.request<ClusterInspection>('POST', `${resource(id)}/inspect-operation`, { body }),
    accept: (body: ClusterOperationRequest) => transport.request<ClusterOperation>('POST', `${base}/operations`, { body }),
    operations: (query: Partial<ClusterOperationQuery> = {}) => transport.request<{ items: ClusterOperation[] }>('GET', `${base}/operations`, { query }),
    reconcile: (id: string) => transport.request<ClusterOperation>('POST', `${base}/operations/${segment(id)}/reconcile`),
    operation: (id: string) => transport.request<ClusterOperation>('GET', `${base}/operations/${segment(id)}`),
  };
}
export type ClusterResourceClient = ReturnType<typeof clusterResource>;
