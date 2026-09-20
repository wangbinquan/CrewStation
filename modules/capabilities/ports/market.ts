import type { Actor, MarketAppDto, MarketAppsQuery, ProjectId, ServiceId, SlotDto } from '@crewstation/contracts';

export type MarketListingSource = Omit<MarketAppDto, 'production' | 'entry'> & { serviceId?: ServiceId };
export interface MarketSources {
  list(actor: Actor, query: MarketAppsQuery): Promise<{ items: MarketListingSource[]; nextCursor?: string }>;
  get(actor: Actor, projectId: ProjectId): Promise<MarketListingSource>;
  /** 只在 project 已裁定市场可见性后调用；只返回部署记录，不推断实时健康。 */
  slots(serviceId: ServiceId): Promise<SlotDto[]>;
}
