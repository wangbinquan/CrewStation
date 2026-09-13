import type { Actor, MarketAppDto, MarketAppsQuery, MarketAppsPage, ProjectId } from '@crewstation/contracts';
import type { Clock } from '@crewstation/kernel';
import type { MarketListingSource, MarketSources } from '../ports/market';

async function withDeadline<T>(work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([work, new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('source timeout')), 2500); })]); }
  finally { clearTimeout(timer); }
}

async function productionOf(sources: MarketSources, listing: MarketListingSource, clock: Clock): Promise<MarketAppDto['production']> {
  const checkedAt = clock.now().toISOString();
  const unknown = { status: 'unknown', freshness: 'unknown', checkedAt } as const;
  if (!listing.serviceId) return listing.projectState === 'provisioning' ? { status: 'not-deployed', freshness: 'current', checkedAt } : unknown;
  try {
    const slots = await withDeadline(sources.slots(listing.serviceId));
    if (slots.length === 0) return { status: 'not-deployed', freshness: 'current', checkedAt: clock.now().toISOString() };
    const active = slots.filter((slot) => slot.name === 'prod' && slot.active);
    if (active.length !== 1) return unknown;
    const slot = active[0]!;
    if (slot.state === 'empty' && !slot.releaseId) return { status: 'not-deployed', freshness: 'current', checkedAt: clock.now().toISOString() };
    if (slot.state === 'empty' || !slot.releaseId || !slot.tag || !slot.commitSha || !slot.host) return unknown;
    return { status: 'deployed', tag: slot.tag, commitSha: slot.commitSha, host: slot.host, state: slot.state, freshness: 'current', checkedAt: clock.now().toISOString() };
  } catch { return unknown; }
}

export function marketAppUseCases(sources: MarketSources, clock: Clock) {
  const detail = async (actor: Actor, projectId: ProjectId): Promise<MarketAppDto> => {
    const listing = await sources.get(actor, projectId);
    const production = await productionOf(sources, listing, clock);
    // 聚合期间可能撤销可见性；返回前再次裁定。内部 serviceId 不进入 HTTP 投影。
    const { serviceId: _serviceId, ...current } = await sources.get(actor, projectId);
    return { ...current, production };
  };
  return {
    getMarketApp: detail,
    listMarketApps: async (actor: Actor, query: MarketAppsQuery): Promise<MarketAppsPage> => {
      const page = await sources.list(actor, query);
      const items: MarketAppDto[] = [];
      // 当前页最多 50 项、同时最多 4 个聚合；没有全平台扇出或后台缓存。
      for (let offset = 0; offset < page.items.length; offset += 4) {
        const results = await Promise.allSettled(page.items.slice(offset, offset + 4).map((item) => detail(actor, item.projectId)));
        for (const result of results) {
          if (result.status === 'fulfilled') items.push(result.value);
          else if (!(result.reason instanceof Object && 'kind' in result.reason && result.reason.kind === 'not_found')) throw result.reason;
        }
      }
      return { items, ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}) };
    },
  };
}
