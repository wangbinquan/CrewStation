import type { AlertDto, HealthDto, LogEntryDto } from '@crewstation/contracts';
import type { Transport } from '../httpTransport';
import type { ItemsPage } from '../itemsPage';
import type { LogQueryInput } from '../requestInputs';
import { segment } from '../requestUrl';

/** observability 模块公开的读取接口。日志来源为 Pod 尾部，不具备全历史分页；调用链在 `traces` 资源里。 */
export interface ObservabilityResource {
  /** GET /v1/projects/:projectId/logs?source=&slot=&taskId=&since=&limit=&cursor= */
  logs(projectId: string, query: LogQueryInput): Promise<ItemsPage<LogEntryDto>>;
  /** GET /v1/projects/:projectId/health：两个部署槽的健康态。 */
  health(projectId: string): Promise<ItemsPage<HealthDto>>;
  alerts(projectId: string): Promise<ItemsPage<AlertDto>>;
}

export function observabilityResource(transport: Transport): ObservabilityResource {
  const project = (projectId: string) => `/v1/projects/${segment(projectId)}`;
  return {
    logs: (projectId, query) => transport.request<ItemsPage<LogEntryDto>>('GET', `${project(projectId)}/logs`, { query }),
    health: (projectId) => transport.request<ItemsPage<HealthDto>>('GET', `${project(projectId)}/health`),
    alerts: (projectId) => transport.request('GET', `${project(projectId)}/alerts`),
  };
}
