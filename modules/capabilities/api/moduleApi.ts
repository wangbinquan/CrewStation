import type { Actor, CapabilityDescriptionDto, ProjectId, MarketAppDto, MarketAppsPage, MarketAppsQuery } from '@crewstation/contracts';

export interface CapabilitiesModuleApi {
  readonly name: 'capabilities';
  describe(actor: Actor, projectId: ProjectId): Promise<CapabilityDescriptionDto>;
  listMarketApps(actor: Actor, query: MarketAppsQuery): Promise<MarketAppsPage>;
  getMarketApp(actor: Actor, projectId: ProjectId): Promise<MarketAppDto>;
}
