import type { HealthDto, LogEntryDto } from '@crewstation/contracts';
import type { Transport } from '../httpTransport';
import type { ItemsPage } from '../itemsPage';
import type { LogQueryInput } from '../requestInputs';
import { segment } from '../requestUrl';

/**
 * 日志与健康态（observability 模块，路由正在建设中）：形状按 contracts/api/observability.ts；
 * 接口未就绪时服务端回 404，工作台按“日志接口尚未就绪”处理。
 */
export interface ObservabilityResource {
  /** GET /v1/projects/:projectId/logs?source=&slot=&taskId=&since=&limit=&cursor= */
  logs(projectId: string, query: LogQueryInput): Promise<ItemsPage<LogEntryDto>>;
  /** GET /v1/projects/:projectId/health：两个部署槽的健康态。 */
  health(projectId: string): Promise<ItemsPage<HealthDto>>;
}

export function observabilityResource(transport: Transport): ObservabilityResource {
  const project = (projectId: string) => `/v1/projects/${segment(projectId)}`;
  return {
    logs: (projectId, query) => transport.request<ItemsPage<LogEntryDto>>('GET', `${project(projectId)}/logs`, { query }),
    health: (projectId) => transport.request<ItemsPage<HealthDto>>('GET', `${project(projectId)}/health`),
  };
}
