import type {RuntimeStorage} from '@crewstation/contracts';
import type { RuntimeMaintenanceRequest, RuntimeMaintenance, RuntimeAnomalyPage } from '@crewstation/contracts';
import type {RuntimeAggregate} from '@crewstation/contracts';
import type { PlatformUsagePage } from '@crewstation/contracts';
import type { OperationalTelemetry, OperationalTelemetryQuery } from '@crewstation/contracts';
import type { RuntimeCompleteReport,RuntimeReportPage,RuntimeReportPageQuery,RuntimeStatisticsQuery } from '@crewstation/contracts';
import type { ExecutionCostVisibilityDto, SetExecutionCostVisibility, ExecutionObservationPage, ExecutionObservationQuery, AlertDto, HealthDto, LogEntryDto, SaveTokenPrice, TokenPriceHistory, TokenPriceProfile, TokenPriceVersion } from '@crewstation/contracts';
import type { Transport } from '../httpTransport';
import type { ItemsPage } from '../itemsPage';
import type { LogQueryInput } from '../requestInputs';
import { segment } from '../requestUrl';

/** observability 模块公开的读取接口。日志来源为 Pod 尾部，不具备全历史分页；调用链在 `traces` 资源里。 */
export type ExecutionObservationInput = ExecutionObservationQuery extends infer Q ? Q extends ExecutionObservationQuery ? Omit<Q, 'limit'> & { limit?: number } : never : never;

export interface ObservabilityResource {
 runtimeStorage():Promise<RuntimeStorage>;
 runtimeMaintenancePreview(input:RuntimeMaintenanceRequest):Promise<RuntimeMaintenance>;
 runtimeMaintenanceStatus(id:string):Promise<RuntimeMaintenance>;
 runtimeMaintenanceConfirm(id:string,digest:string):Promise<RuntimeMaintenance>;
  runtimeAnomalies(projectId:string|undefined,query:RuntimeStatisticsQuery,after?:string):Promise<RuntimeAnomalyPage>;
  runtimeAggregate(projectId:string|undefined,query:RuntimeStatisticsQuery):Promise<RuntimeAggregate>;
  runtimeProjectionStreamUrl(projectId:string|undefined):string;
  platformUsage(query:RuntimeStatisticsQuery,after?:string):Promise<PlatformUsagePage>;
  operationalTelemetry(projectId:string|undefined,query:OperationalTelemetryQuery):Promise<OperationalTelemetry>;
  projectRuntimeStatistics(projectId: string, query: RuntimeStatisticsQuery): Promise<RuntimeCompleteReport>;
  systemRuntimeStatistics(query: RuntimeStatisticsQuery): Promise<RuntimeCompleteReport>;
  projectRuntimeTask(projectId: string, taskId: string): Promise<RuntimeCompleteReport>;
  systemRuntimeTask(taskId: string): Promise<RuntimeCompleteReport>;
  runtimeReportStatus(projectId:string|undefined,reportId:string):Promise<RuntimeCompleteReport>;
  runtimeReportPage<T>(projectId:string|undefined,reportId:string,query:RuntimeReportPageQuery):Promise<RuntimeReportPage<T>>;
  executionObservations(taskId: string, query?: ExecutionObservationInput): Promise<ExecutionObservationPage>;
  executionCostVisibility(projectId: string): Promise<ExecutionCostVisibilityDto>;
  setExecutionCostVisibility(projectId: string, input: SetExecutionCostVisibility): Promise<ExecutionCostVisibilityDto>;
  pricingProfiles(): Promise<{ items: TokenPriceProfile[] }>;
  priceHistory(profileId: string, query?: { limit?: number; beforeRevision?: number }): Promise<TokenPriceHistory>;
  savePrice(profileId: string, input: SaveTokenPrice): Promise<TokenPriceVersion>;
  /** GET /v1/projects/:projectId/logs?source=&slot=&taskId=&since=&limit=&cursor= */
  logs(projectId: string, query: LogQueryInput): Promise<ItemsPage<LogEntryDto>>;
  /** GET /v1/projects/:projectId/health：两个部署槽的健康态。 */
  health(projectId: string): Promise<ItemsPage<HealthDto>>;
  alerts(projectId: string): Promise<ItemsPage<AlertDto>>;
}

export function observabilityResource(transport: Transport): ObservabilityResource {
  const project = (projectId: string) => `/v1/projects/${segment(projectId)}`;
  const pricing = '/v1/admin/observability/pricing/profiles';
  const visibility = (id: string) => '/v1/admin/observability/projects/' + segment(id) + '/cost-visibility';
  return {
    runtimeStorage:()=>transport.request('GET','/v1/admin/observability/storage'),
runtimeMaintenancePreview:body=>transport.request('POST','/v1/admin/observability/maintenance/preview',{body}),
    runtimeMaintenanceStatus:id=>transport.request('GET','/v1/admin/observability/maintenance/'+segment(id)),
    runtimeMaintenanceConfirm:(id,digest)=>transport.request('POST','/v1/admin/observability/maintenance/'+segment(id)+'/confirm',{body:{expectedDigest:digest,confirmation:'APPLY'}}),
    runtimeAnomalies:(id,query,after)=>transport.request('GET',(id?project(id):'/v1/admin')+'/observability/anomalies',{query:{...query,after}}),
    runtimeAggregate:(id,query)=>transport.request('GET',(id?project(id):'/v1/admin')+'/observability/aggregate',{query:{...query}}),
    runtimeProjectionStreamUrl:id=>transport.baseUrl+(id?project(id):'/v1/admin')+'/observability/projection-stream',
    platformUsage:(query,after)=>transport.request('GET','/v1/admin/observability/platform-usage',{query:{...query,after}}),
    operationalTelemetry:(id,query)=>transport.request('GET',(id?project(id):'/v1/admin')+'/observability/telemetry',{query:{...query}}),
    projectRuntimeStatistics: (id, query) => transport.request('GET', project(id) + '/observability/statistics', { query: { ...query } }),
    systemRuntimeStatistics: (query) => transport.request('GET', '/v1/admin/observability/statistics', { query: { ...query } }),
    projectRuntimeTask: (id, taskId) => transport.request('GET', project(id) + '/observability/tasks/' + segment(taskId)),
    systemRuntimeTask: (taskId) => transport.request('GET', '/v1/admin/observability/tasks/' + segment(taskId)),
    runtimeReportStatus: (id,reportId)=>transport.request('GET',(id?project(id):'/v1/admin')+'/observability/reports/'+segment(reportId)),
    runtimeReportPage: <T>(id:string|undefined,reportId:string,query:RuntimeReportPageQuery)=>transport.request<RuntimeReportPage<T>>('GET',(id?project(id):'/v1/admin')+'/observability/reports/'+segment(reportId)+'/pages',{query:{...query}}),
    executionObservations: (id, query = {}) => transport.request('GET', '/v3/business-tasks/' + segment(id) + '/observations', { query }),
    executionCostVisibility: (id) => transport.request('GET', visibility(id)),
    setExecutionCostVisibility: (id, body) => transport.request('PUT', visibility(id), { body }),
    pricingProfiles: () => transport.request('GET', pricing),
    priceHistory: (id, query = {}) => transport.request('GET', pricing + '/' + segment(id) + '/versions', { query }),
    savePrice: (id, body) => transport.request('POST', pricing + '/' + segment(id) + '/versions', { body }),
    logs: (projectId, query) => transport.request<ItemsPage<LogEntryDto>>('GET', `${project(projectId)}/logs`, { query }),
    health: (projectId) => transport.request<ItemsPage<HealthDto>>('GET', `${project(projectId)}/health`),
    alerts: (projectId) => transport.request('GET', `${project(projectId)}/alerts`),
  };
}
