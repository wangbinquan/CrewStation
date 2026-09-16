import { Link, useParams } from '@tanstack/react-router';
import { api } from '../../../shared/api/client';
import { useT } from '../../../shared/lib/useT';
import { Button } from '../../../shared/ui/Button';
import { EmptyState } from '../../../shared/ui/EmptyState';
import { PageHeader } from '../../../shared/ui/PageHeader';
import { QueryStatus } from '../../../shared/ui/QueryStatus';
import { MarketAppDetail } from '../components/market/MarketAppCard';
import { useMarketQuery } from '../model/useMarketQuery';

export function MarketDetailPage() {
  const t = useT(), { projectId } = useParams({ strict: false });
  const query = useMarketQuery(['app', projectId], () => api.capabilities.marketApp(projectId!));
  // 404 是明确状态（可见范围已收回或应用不存在），不是可重试的读取失败；服务器原话保留，返回路径始终可用（design.md §3）。
  const gone = !query.isFetching && (query.error as { status?: number } | null)?.status === 404 ? query.error : null;
  return <>
    <PageHeader title={t('market.detail')} actions={<><Link to="/market">{t('market.back')}</Link><Button disabled={query.isFetching} onClick={() => { void query.refetch(); }}>{t('market.refresh')}</Button></>} />
    {gone ? <EmptyState title={t('market.gone')} description={t('market.goneHint', { message: gone.message })} action={<Link to="/market">{t('market.back')}</Link>} /> : <QueryStatus isPending={query.isPending || query.isFetching} error={query.error} />}
    {query.current ? <MarketAppDetail app={query.current} /> : null}
  </>;
}
