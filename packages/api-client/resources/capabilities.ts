import type { CapabilityDescriptionDto, MarketAppDto, MarketAppsPage, MarketAppsQuery } from '@crewstation/contracts';
import type { Transport } from '../httpTransport';
import { segment } from '../requestUrl';

/** 能力说明（R48）：与能力说明 MCP 同源的聚合视图。 */
export interface CapabilitiesResource {
  /** GET /v1/projects/:projectId/capabilities */
  describe(projectId: string): Promise<CapabilityDescriptionDto>;
  marketApps(query?: Partial<MarketAppsQuery>): Promise<MarketAppsPage>;
  marketApp(projectId: string): Promise<MarketAppDto>;
}

export function capabilitiesResource(transport: Transport): CapabilitiesResource {
  return {
    describe: (projectId) => transport.request<CapabilityDescriptionDto>('GET', `/v1/projects/${segment(projectId)}/capabilities`),
    marketApps: (query = {}) => transport.request('GET', '/v1/market/apps', { query }),
    marketApp: (id) => transport.request('GET', `/v1/market/apps/${segment(id)}`),
  };
}
