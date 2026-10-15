import type {
  AlertDto, HealthDto, LogEntryDto, ObservationAgentPage, ObservationModelPage, ObservationOverview, ObservationPlatformPage, ObservationPlatformQuery,
  ObservationPrice, ObservationPriceHistory, ObservationPricingDirectory, ObservationProjectPage, ObservationTaskDetail, ObservationTaskPage,
  ObservationTaskPageQuery, ObservationWindowQuery, OperationalTelemetry, OperationalTelemetryQuery, ProjectCostVisibility, SaveObservationPriceInput,
  SetProjectCostVisibility,
} from '@crewstation/contracts';
import type { Transport } from '../httpTransport';
import type { ItemsPage } from '../itemsPage';
import type { LogQueryInput } from '../requestInputs';
import { segment } from '../requestUrl';

/** 统计查询的输入：日桶按浏览器时区切，缺省按 UTC。 */
export type ObservationWindowInput = Omit<ObservationWindowQuery, 'tzOffset'> & { tzOffset?: number };
export type ObservationTaskPageInput = Omit<ObservationTaskPageQuery, 'tzOffset'> & { tzOffset?: number };
export type ObservationPlatformInput = Omit<ObservationPlatformQuery, 'tzOffset'> & { tzOffset?: number };

/**
 * observability 模块公开的读取接口。运行统计（RFC-034 v2）按项目（`projectId`）或系统（省略）两级：
 * 每次请求即时聚合，没有报告或水位。日志来源为 Pod 尾部，不具备全历史分页；调用链在 `traces` 资源里。
 */
export interface ObservabilityResource {
  overview(projectId: string | undefined, query: ObservationWindowInput): Promise<ObservationOverview>;
  tasks(projectId: string | undefined, query: ObservationTaskPageInput): Promise<ObservationTaskPage>;
  task(projectId: string | undefined, taskId: string): Promise<ObservationTaskDetail>;
  agents(projectId: string | undefined, query: ObservationWindowInput): Promise<ObservationAgentPage>;
  models(projectId: string | undefined, query: ObservationWindowInput): Promise<ObservationModelPage>;
  /** 仅系统：按项目比较。 */
  projects(query: ObservationWindowInput): Promise<ObservationProjectPage>;
  /** 仅系统：不属于项目的平台执行（档位测试等）。 */
  platform(query: ObservationPlatformInput): Promise<ObservationPlatformPage>;
  pricing(): Promise<ObservationPricingDirectory>;
  priceHistory(profileId: string, model: string): Promise<ObservationPriceHistory>;
  savePrice(profileId: string, input: SaveObservationPriceInput): Promise<ObservationPrice>;
  costVisibility(projectId: string): Promise<ProjectCostVisibility>;
  setCostVisibility(projectId: string, input: SetProjectCostVisibility): Promise<ProjectCostVisibility>;
  operationalTelemetry(projectId: string | undefined, query: OperationalTelemetryQuery): Promise<OperationalTelemetry>;
  /** GET /v1/projects/:projectId/logs?source=&slot=&taskId=&since=&limit=&cursor= */
  logs(projectId: string, query: LogQueryInput): Promise<ItemsPage<LogEntryDto>>;
  /** GET /v1/projects/:projectId/health：两个部署槽的健康态。 */
  health(projectId: string): Promise<ItemsPage<HealthDto>>;
  alerts(projectId: string): Promise<ItemsPage<AlertDto>>;
}

export function observabilityResource(transport: Transport): ObservabilityResource {
  const project = (projectId: string) => `/v1/projects/${segment(projectId)}`;
  const scope = (projectId: string | undefined) => (projectId ? project(projectId) : '/v1/admin') + '/observability';
  const pricing = '/v1/admin/observability/pricing';
  const visibility = (id: string) => '/v1/admin/observability/projects/' + segment(id) + '/cost-visibility';
  return {
    overview: (id, query) => transport.request('GET', scope(id) + '/overview', { query: { ...query } }),
    tasks: (id, query) => transport.request('GET', scope(id) + '/tasks', { query: { ...query } }),
    task: (id, taskId) => transport.request('GET', scope(id) + '/tasks/' + segment(taskId)),
    agents: (id, query) => transport.request('GET', scope(id) + '/agents', { query: { ...query } }),
    models: (id, query) => transport.request('GET', scope(id) + '/models', { query: { ...query } }),
    projects: (query) => transport.request('GET', '/v1/admin/observability/projects', { query: { ...query } }),
    platform: (query) => transport.request('GET', '/v1/admin/observability/platform', { query: { ...query } }),
    pricing: () => transport.request('GET', pricing),
    priceHistory: (profileId, model) => transport.request('GET', pricing + '/' + segment(profileId) + '/history', { query: { model } }),
    savePrice: (profileId, body) => transport.request('POST', pricing + '/' + segment(profileId), { body }),
    costVisibility: (id) => transport.request('GET', visibility(id)),
    setCostVisibility: (id, body) => transport.request('PUT', visibility(id), { body }),
    operationalTelemetry: (id, query) => transport.request('GET', scope(id) + '/telemetry', { query: { ...query } }),
    logs: (projectId, query) => transport.request<ItemsPage<LogEntryDto>>('GET', `${project(projectId)}/logs`, { query }),
    health: (projectId) => transport.request<ItemsPage<HealthDto>>('GET', `${project(projectId)}/health`),
    alerts: (projectId) => transport.request('GET', `${project(projectId)}/alerts`),
  };
}
