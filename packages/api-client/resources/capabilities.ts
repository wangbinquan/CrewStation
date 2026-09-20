import type { MarketTrialDto, CapabilityDescriptionDto, MarketAppDto, MarketAppsPage, MarketAppsQuery, ProjectPageQuery, ProjectSummariesPage, ProjectSummaryDetail } from '@crewstation/contracts';
import type { Transport } from '../httpTransport';
import { segment } from '../requestUrl';

/** 能力说明（R48）：与能力说明 MCP 同源的聚合视图。 */
export interface CapabilitiesResource {
  /** GET /v1/projects/:projectId/capabilities */
  describe(projectId: string): Promise<CapabilityDescriptionDto>;
  marketApps(query?: Partial<MarketAppsQuery>): Promise<MarketAppsPage>;
  marketTrial(projectId: string): Promise<MarketTrialDto>;
  marketApp(projectId: string): Promise<MarketAppDto>;
  projectSummaries(query?: Partial<ProjectPageQuery>): Promise<ProjectSummariesPage>;
  projectSummary(projectId: string): Promise<ProjectSummaryDetail>;
}

export function capabilitiesResource(transport: Transport): CapabilitiesResource {
  return {
    describe: (projectId) => transport.request<CapabilityDescriptionDto>('GET', `/v1/projects/${segment(projectId)}/capabilities`),
    marketApps: (query = {}) => transport.request('GET', '/v1/market/apps', { query }),
    marketTrial: (id) => transport.request('GET', `/v1/market/apps/${segment(id)}/trial`),
    marketApp: (id) => transport.request('GET', `/v1/market/apps/${segment(id)}`),
    projectSummaries: (query = {}) => transport.request('GET', '/v1/workbench/project-summaries', { query: { ...query, kind: query.kind?.join(',') } }),
    projectSummary: (id) => transport.request('GET', `/v1/workbench/project-summaries/${segment(id)}`),
  };
}
