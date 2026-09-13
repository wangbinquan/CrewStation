import { Link, useParams } from '@tanstack/react-router';
import { api } from '../../../shared/api/client';
import { useT } from '../../../shared/lib/useT';
import { Button } from '../../../shared/ui/Button';
import { PageHeader } from '../../../shared/ui/PageHeader';
import { QueryStatus } from '../../../shared/ui/QueryStatus';
import { MarketAppDetail } from '../components/market/MarketAppCard';
import { useMarketQuery } from '../model/useMarketQuery';

export function MarketDetailPage() {
  const t = useT(), { projectId } = useParams({ strict: false });
  const query = useMarketQuery(['app', projectId], () => api.capabilities.marketApp(projectId!));
  return <>
    <PageHeader title={t('market.detail')} actions={<><Link to="/market">{t('market.back')}</Link><Button disabled={query.isFetching} onClick={() => { void query.refetch(); }}>{t('market.refresh')}</Button></>} />
    <QueryStatus isPending={query.isPending || query.isFetching} error={query.error} />
    {query.current ? <MarketAppDetail app={query.current} /> : null}
  </>;
}
