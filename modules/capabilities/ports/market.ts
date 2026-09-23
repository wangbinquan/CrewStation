import type { Actor, MarketAppDto, MarketAppsQuery, ProjectId, ServiceId, SlotDto } from '@crewstation/contracts';

export type MarketListingSource = Omit<MarketAppDto, 'production' | 'entry'> & { serviceId?: ServiceId };
export interface MarketSources {
  list(actor: Actor, query: MarketAppsQuery): Promise<{ items: MarketListingSource[]; nextCursor?: string }>;
  get(actor: Actor, projectId: ProjectId): Promise<MarketListingSource>;
  /** 只在 project 已裁定市场可见性后调用；只返回部署记录，不推断实时健康。 */
  slots(serviceId: ServiceId): Promise<SlotDto[]>;
  /** RFC-021：正式版本维护中时的开关、原因、预计恢复时间与临时指定的人；由 gateway 模块经装配提供。 */
  maintenance?(serviceId: ServiceId): Promise<MarketMaintenance | undefined>;
}

export interface MarketMaintenance {
  readonly switches: { readonly users: boolean };
  readonly allowUserIds: readonly string[];
  readonly reason: string;
  readonly expectedEndAt?: Date;
}
