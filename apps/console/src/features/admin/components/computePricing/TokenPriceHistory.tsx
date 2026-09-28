import type { TokenPriceProfile } from '@crewstation/contracts';
import { useState } from 'react';
import { api } from '../../../../shared/api/client';
import { useApiQuery } from '../../../../shared/api/useApi';
import { useDateText } from '../../../../shared/lib/useDateText';
import { useT } from '../../../../shared/lib/useT';
import { Dialog } from '../../../../shared/ui/dialog/Dialog';
import { DataTable } from '../../../../shared/ui/DataTable';
import { QueryStatus } from '../../../../shared/ui/QueryStatus';
import { Button } from '../../../../shared/ui/Button';
import { ActionRow } from '../../../../shared/ui/ActionRow';
import { Stack } from '../../../../shared/ui/Stack';
import { priceBuckets } from '../../model/tokenPriceDraft';

export function TokenPriceHistory({ profile, onClose }: { profile: TokenPriceProfile; onClose: () => void }) {
  const t = useT(), dateText = useDateText();
  const [cursors, setCursors] = useState<Array<number | undefined>>([undefined]);
  const beforeRevision = cursors.at(-1);
  const query = useApiQuery(['admin', 'token-pricing', profile.id, 'history', beforeRevision], () => api.observability.priceHistory(profile.id, { limit: 20, ...(beforeRevision === undefined ? {} : { beforeRevision }) }));
  const next = query.data?.nextBeforeRevision;
  return <Dialog title={t('admin.pricing.historyTitle', { name: profile.name })} size="large" onClose={onClose}>
    <Stack>
      <p>{t('admin.pricing.historyHint')}</p>
      <QueryStatus isPending={query.isPending} error={query.error} isEmpty={!query.data?.items.length} emptyTitle={t('admin.pricing.unpriced')} />
      {query.data?.items.length ? <DataTable columns={['revision', 'model', 'effectiveFrom', ...priceBuckets].map((key) => t('admin.pricing.' + key))}>
        {query.data.items.map((version) => <tr key={version.id}>
          <td>{'CNY-v' + version.revision}<br />{version.sourceNote}</td><td>{version.provider} / {version.model}<br />{version.condition ?? '—'}</td>
          <td>{dateText(version.effectiveFrom)}</td>
          {priceBuckets.map((bucket) => <td key={bucket}>{version.rates[bucket] === null ? t('admin.pricing.unpriced') : '¥' + version.rates[bucket]}</td>)}
        </tr>)}
      </DataTable> : null}
      <ActionRow><Button disabled={cursors.length === 1 || query.isPending} onClick={() => setCursors((current) => current.slice(0, -1))}>{t('admin.pricing.previous')}</Button>
        <Button disabled={next === undefined || query.isPending} onClick={() => { if (next !== undefined) setCursors((current) => [...current, next]); }}>{t('admin.pricing.next')}</Button></ActionRow>
    </Stack>
  </Dialog>;
}
