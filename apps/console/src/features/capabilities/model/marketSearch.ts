import { MarketAppsQuerySchema } from '@crewstation/contracts';
import type { MarketAppsQuery } from '@crewstation/contracts';

export type MarketSearch = Partial<MarketAppsQuery> & { ownerName?: string };

/** 路由只接纳市场查询字段；无效书签回到第一页，不把任意参数传给服务端。 */
export function parseMarketSearch(raw: Record<string, unknown>): MarketSearch {
  const parsed = MarketAppsQuerySchema.safeParse(raw);
  if (!parsed.success) return {};
  const { q, ownerId, cursor, limit } = parsed.data;
  return { ...(q ? { q } : {}), ...(ownerId ? { ownerId } : {}), ...(cursor ? { cursor } : {}),
    ...(limit === 50 ? { limit } : {}), ...(ownerId && typeof raw.ownerName === 'string' ? { ownerName: raw.ownerName.slice(0, 120) } : {}) };
}

/** 标签页内只记本用户走过的前页。分享的游标没有前页记录时可回第一页。 */
export function marketHistory(userId: string | undefined, search: MarketSearch) {
  const key = `cs-market:${userId ?? ''}:${JSON.stringify([search.q ?? '', search.ownerId ?? '', search.limit ?? 20])}`;
  const read = (): Record<string, string> => {
    try {
      const parsed: unknown = JSON.parse(sessionStorage.getItem(key) ?? '{}');
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? Object.fromEntries(Object.entries(parsed).filter((entry) => typeof entry[1] === 'string')) : {};
    } catch { return {}; }
  };
  return {
    previous: search.cursor ? read()[search.cursor] : undefined,
    remember: (next: string) => {
      if (!userId) return;
      try { sessionStorage.setItem(key, JSON.stringify({ ...Object.fromEntries(Object.entries(read()).slice(-99)), [next]: search.cursor ?? '' })); } catch { /* 禁用存储时仍可前进及回第一页。 */ }
    },
    clear: () => { try { sessionStorage.removeItem(key); } catch { /* 查询不依赖可写存储。 */ } },
  };
}
