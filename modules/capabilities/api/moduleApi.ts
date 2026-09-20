import type { Actor, CapabilityDescriptionDto, ProjectId, MarketTrialDto, MarketAppDto, MarketAppsPage, MarketAppsQuery } from '@crewstation/contracts';
import type { ProjectPageQuery, ProjectSummariesPage, ProjectSummaryDetail } from '@crewstation/contracts';

export interface CapabilitiesModuleApi {
  readonly name: 'capabilities';
  describe(actor: Actor, projectId: ProjectId): Promise<CapabilityDescriptionDto>;
  listMarketApps(actor: Actor, query: MarketAppsQuery): Promise<MarketAppsPage>;
  getMarketTrial(actor: Actor, projectId: ProjectId): Promise<MarketTrialDto>;
  getMarketApp(actor: Actor, projectId: ProjectId): Promise<MarketAppDto>;
  listProjectSummaries(actor: Actor, query: ProjectPageQuery): Promise<ProjectSummariesPage>;
  getProjectSummary(actor: Actor, projectId: ProjectId): Promise<ProjectSummaryDetail>;
}
