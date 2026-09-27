import { useNavigate, useSearch } from '@tanstack/react-router';
import { api } from '../../../shared/api/client';
import { useT } from '../../../shared/lib/useT';
import { Button } from '../../../shared/ui/Button';
import { EmptyState } from '../../../shared/ui/EmptyState';
import { PageHeader } from '../../../shared/ui/PageHeader';
import { QueryStatus } from '../../../shared/ui/QueryStatus';
import { MarketResults } from '../components/market/MarketResults';
import { MarketToolbar } from '../components/market/MarketToolbar';
import { marketHistory, parseMarketSearch } from '../model/marketSearch';
import type { MarketSearch } from '../model/marketSearch';
import { useMarketQuery } from '../model/useMarketQuery';
import styles from '../components/market/Market.module.css';

export function MarketPage() {
  const t = useT(), navigate = useNavigate(), search = parseMarketSearch(useSearch({ strict: false }));
  const { ownerName: _ownerName, ...filter } = search;
  const query = useMarketQuery(['apps', filter], async () => {
    const page = await api.capabilities.marketApps({ ...filter, q: filter.q ?? '', limit: filter.limit ?? 20 });
    if (!page || !Array.isArray(page.items)) throw new Error(t('market.invalidResponse'));
    return page;
  });
  const history = marketHistory(query.userId, search), scope = JSON.stringify([query.userId, filter]);
  const change = (next: MarketSearch) => { void navigate({ to: '/market', search: parseMarketSearch(next), resetScroll: true }); };
  const restart = () => { history.clear(); change({ limit: search.limit }); };
  const filtered = Boolean(search.q || search.ownerId);
  return <>
    <PageHeader title={t('market.title')} />
    <MarketToolbar key={`toolbar:${scope}`} search={search} onChange={(next) => { history.clear(); change(next); }} />
    <QueryStatus isPending={query.isPending} error={query.error} />
    {query.current?.items.length === 0 ? <EmptyState title={t(query.current.nextCursor ? 'market.pageEmpty' : filtered ? 'market.noMatches' : 'market.noApps')} description={t(query.current.nextCursor ? 'market.pageEmptyHint' : filtered ? 'market.noMatchesHint' : 'market.noAppsHint')} action={filtered ? <Button onClick={restart}>{t('market.reset')}</Button> : undefined} /> : null}
    {query.current ? <MarketResults key={`results:${scope}`} items={query.current.items} onOwner={(app) => { history.clear(); change({ ...search, ownerId: app.owner.userId, ownerName: app.owner.name, cursor: undefined }); }} /> : null}
    <div className={styles.pagination}>
      {search.cursor ? <Button disabled={query.isPending} onClick={() => change({ ...search, cursor: history.previous || undefined })}>{t(history.previous === undefined ? 'market.firstPage' : 'market.previous')}</Button> : null}
      {query.current?.nextCursor ? <Button disabled={query.isPending} onClick={() => { const next = query.current!.nextCursor!; history.remember(next); change({ ...search, cursor: next }); }}>{t('market.next')}</Button> : null}
    </div>
  </>;
}
