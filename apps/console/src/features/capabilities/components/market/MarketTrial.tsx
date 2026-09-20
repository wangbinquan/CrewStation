import { api } from '../../../../shared/api/client';
import { useT } from '../../../../shared/lib/useT';
import { Button } from '../../../../shared/ui/Button';
import { Card } from '../../../../shared/ui/Card';
import { QueryStatus } from '../../../../shared/ui/QueryStatus';
import { useMarketQuery } from '../../model/useMarketQuery';
import { marketHref } from './marketHref';

export function MarketTrial({ projectId }: { readonly projectId: string }) {
  const t = useT();
  const query = useMarketQuery(['trial', projectId], () => api.capabilities.marketTrial(projectId));
  const trial = query.current, href = trial?.status === 'ready' ? marketHref(trial.host) : undefined;
  return <Card compact title={t('market.trialTitle')}>
    <QueryStatus isPending={query.isPending || query.isFetching} error={query.error} />
    <p>{t('market.sharedData')}</p>
    {href ? <a href={href} target="_blank" rel="noopener noreferrer">{t('market.try')} ↗</a> : <p>{t('market.notAvailable')}</p>}
    {query.error ? <Button onClick={() => void query.refetch()}>{t('market.retry')}</Button> : null}
  </Card>;
}
