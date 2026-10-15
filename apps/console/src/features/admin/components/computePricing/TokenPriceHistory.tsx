import type { ObservationPricingProfile } from '@crewstation/contracts';
import { api } from '../../../../shared/api/client';
import { useApiQuery } from '../../../../shared/api/useApi';
import { useDateText } from '../../../../shared/lib/useDateText';
import { useT } from '../../../../shared/lib/useT';
import { DataTable } from '../../../../shared/ui/DataTable';
import { QueryStatus } from '../../../../shared/ui/QueryStatus';
import { Stack } from '../../../../shared/ui/Stack';
import { Dialog } from '../../../../shared/ui/dialog/Dialog';
import { priceBuckets } from '../../model/tokenPriceDraft';

/** 一条价格线的全部版本（只追加，新的在前）；执行按开始时生效且开始前已创建的版本计价。 */
export function TokenPriceHistory({ profile, model, onClose }: { profile: ObservationPricingProfile; model: string; onClose: () => void }) {
  const t = useT(), dateText = useDateText();
  const query = useApiQuery(['admin', 'token-pricing', profile.profileId, 'history', model], () => api.observability.priceHistory(profile.profileId, model));
  const items = query.error ? [] : query.data?.items ?? [];
  return <Dialog title={t('admin.pricing.historyTitle', { name: profile.name, model })} size="large" onClose={onClose}>
    <Stack>
      <p>{t('admin.pricing.historyHint')}</p>
      <QueryStatus isPending={query.isPending} error={query.error} isEmpty={items.length === 0} emptyTitle={t('admin.pricing.unpriced')} />
      {items.length ? <DataTable columns={['effectiveFrom', ...priceBuckets, 'createdAt', 'note'].map((key) => t('admin.pricing.' + key))}>
        {items.map((version) => <tr key={version.id}>
          <td>{dateText(version.effectiveFrom)}</td>
          {priceBuckets.map((bucket) => <td key={bucket}>{version.rates[bucket] === null ? t('admin.pricing.unknownRate') : '¥' + version.rates[bucket]}</td>)}
          <td>{dateText(version.createdAt)}</td>
          <td>{version.note || '—'}</td>
        </tr>)}
      </DataTable> : null}
    </Stack>
  </Dialog>;
}
