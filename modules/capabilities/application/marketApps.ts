import type { Actor, MarketAppDto, MarketAppsQuery, MarketAppsPage, MarketTrialDto, ProjectId } from '@crewstation/contracts';
import { forbidden } from '@crewstation/kernel';
import { entryOf, marketSlots, productionOf, trialOf } from './marketDeployment';
import type { Clock } from '@crewstation/kernel';
import type { MarketSources } from '../ports/market';

export function marketAppUseCases(sources: MarketSources, clock: Clock) {
  const detail = async (actor: Actor, projectId: ProjectId): Promise<MarketAppDto> => {
    const listing = await sources.get(actor, projectId);
    const slots = await marketSlots(sources, listing);
    const production = productionOf(slots, clock);
    // 聚合期间可能撤销可见性；返回前再次裁定。内部 serviceId 不进入 HTTP 投影。
    const { serviceId: _serviceId, ...current } = await sources.get(actor, projectId);
    const trial = current.canPreview && production.status === 'deployed' ? trialOf(slots, current) : undefined;
    return { ...current, production, entry: entryOf(production, current, slots),
      ...(trial ? { trial: { status: trial.status, ...(trial.host ? { host: trial.host } : {}) } } : {}) };
  };
  return {
    getMarketApp: detail,
    getMarketTrial: async (actor: Actor, projectId: ProjectId): Promise<MarketTrialDto> => {
      const listing = await sources.get(actor, projectId);
      if (!listing.canPreview) throw forbidden('你不是此应用的试用成员');
      const slots = await marketSlots(sources, listing);
      const current = await sources.get(actor, projectId);
      if (!current.canPreview) throw forbidden('试用资格已变化');
      return { projectId, name: current.name, ...trialOf(slots, current), checkedAt: clock.now().toISOString(), sharedData: true };
    },
    listMarketApps: async (actor: Actor, query: MarketAppsQuery): Promise<MarketAppsPage> => {
      const page = await sources.list(actor, query);
      const items: MarketAppDto[] = [];
      // 当前页最多 50 项、同时最多 4 个聚合；没有全平台扇出或后台缓存。
      for (let offset = 0; offset < page.items.length; offset += 4) {
        const results = await Promise.allSettled(page.items.slice(offset, offset + 4).map((item) => detail(actor, item.projectId)));
        for (const result of results) {
          if (result.status === 'fulfilled') {
            if (result.value.production.status !== 'not-deployed' || result.value.canPreview) items.push(result.value);
          }
          else if (!(result.reason instanceof Object && 'kind' in result.reason && result.reason.kind === 'not_found')) throw result.reason;
        }
      }
      return { items, ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}) };
    },
  };
}
