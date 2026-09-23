import { useState } from 'react';
import { api } from '../../../shared/api/client';
import { useT } from '../../../shared/lib/useT';
import { Button } from '../../../shared/ui/Button';
import { EmptyState } from '../../../shared/ui/EmptyState';
import { FormField } from '../../../shared/ui/FormField';
import { PageHeader } from '../../../shared/ui/PageHeader';
import { QueryStatus } from '../../../shared/ui/QueryStatus';
import { MarketAppCard } from '../components/market/MarketAppCard';
import { useMarketQuery } from '../model/useMarketQuery';
import styles from '../components/market/Market.module.css';

export function MarketPage() {
  const t = useT(), [input, setInput] = useState(''), [q, setQ] = useState(''), [cursors, setCursors] = useState<string[]>([]);
  const cursor = cursors.at(-1);
  const query = useMarketQuery(['apps', q, cursor], async () => {
    const page = await api.capabilities.marketApps({ q, limit: 20, ...(cursor ? { cursor } : {}) });
    if (!page || !Array.isArray(page.items)) throw new Error(t('market.invalidResponse'));
    return page;
  });
  const restart = () => { setInput(''); setQ(''); setCursors([]); };
  return <>
    <PageHeader title={t('market.title')} description={[t('market.intro')]} />
    <form className={styles.search} onSubmit={(event) => { event.preventDefault(); setQ(input.trim()); setCursors([]); }}>
      <FormField label={t('market.search')} hint={t('market.searchHint')}><input value={input} maxLength={120} onChange={(event) => setInput(event.target.value)} /></FormField>
      <Button type="submit" variant="primary">{t('market.searchAction')}</Button>
      {q || cursor ? <Button onClick={restart}>{t('market.reset')}</Button> : null}
    </form>
    {/* 不给「重新查询」：市场每 15 秒自动重读，读取失败也一样（2026-09-23 裁定）；回第一页用「重置」或「上一页」。 */}
    <QueryStatus isPending={query.isPending} error={query.error} />
    {query.current?.items.length === 0 ? <EmptyState title={t(query.current.nextCursor ? 'market.pageEmpty' : q ? 'market.noMatches' : 'market.noApps')} description={t(query.current.nextCursor ? 'market.pageEmptyHint' : q ? 'market.noMatchesHint' : 'market.noAppsHint')} action={q ? <Button onClick={restart}>{t('market.reset')}</Button> : undefined} /> : null}
    <div className={styles.grid}>{query.current?.items.map((app) => <MarketAppCard key={app.projectId} app={app} />)}</div>
    <div className={styles.pagination}>
      {cursor ? <Button disabled={query.isPending} onClick={() => setCursors(cursors.slice(0, -1))}>{t('market.previous')}</Button> : null}
      {query.current?.nextCursor ? <Button onClick={() => setCursors([...cursors, query.current!.nextCursor!])}>{t('market.next')}</Button> : null}
    </div>
  </>;
}
