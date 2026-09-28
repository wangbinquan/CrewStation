import { ProjectCostVisibilityManager } from './ProjectCostVisibilityManager';
import type { TokenPriceProfile } from '@crewstation/contracts';
import { useState } from 'react';
import { api } from '../../../../shared/api/client';
import { AUTO_REFRESH, useApiQuery } from '../../../../shared/api/useApi';
import { useDraftTarget } from '../../../../shared/lib/useDraftTarget';
import { useT } from '../../../../shared/lib/useT';
import { Button } from '../../../../shared/ui/Button';
import { Card } from '../../../../shared/ui/Card';
import { DataTable } from '../../../../shared/ui/DataTable';
import { QueryStatus } from '../../../../shared/ui/QueryStatus';
import { ActionRow } from '../../../../shared/ui/ActionRow';
import { CatalogSearch } from '../../../../shared/ui/catalog/CatalogSearch';
import { ConfirmationDialog } from '../../../../shared/ui/dialog/ConfirmationDialog';
import { TokenPriceEditor } from './TokenPriceEditor';
import { TokenPriceHistory } from './TokenPriceHistory';

export const TOKEN_PRICING_QUERY = ['admin', 'token-pricing'] as const;
export function TokenPricingSection({ search, onSearch }: { search: string; onSearch: (value: string) => void }) {
  const t = useT(), panel = useDraftTarget<TokenPriceProfile>((a, b) => a.id === b.id);
  const [history, setHistory] = useState<TokenPriceProfile>(), [projectsOpen, setProjectsOpen] = useState(false);
  const query = useApiQuery(TOKEN_PRICING_QUERY, () => api.observability.pricingProfiles(), AUTO_REFRESH);
  const rows = [401, 403].includes(query.error?.status ?? 0) ? [] : query.data?.items ?? [];
  const matching = rows.filter((row) => [row.name, row.model, row.protocol].some((value) => value?.toLowerCase().includes(search.trim().toLowerCase())));
  return <>
    <Card stacked>
      <p>{t('admin.pricing.hint')}</p>
      <ActionRow><Button onClick={() => setProjectsOpen(true)}>{t('admin.pricing.visibility.title')}</Button></ActionRow>
      <CatalogSearch value={search} label={t('admin.profile.search')} onSearch={onSearch} />
      <QueryStatus isPending={query.isPending} error={query.error} isEmpty={matching.length === 0} emptyTitle={t('admin.pricing.empty')} />
      {matching.length ? <DataTable columns={['name', 'model', 'revision', 'actions'].map((key) => t('admin.pricing.' + key))}>
        {matching.map((row) => <tr key={row.id}>
          <td>{row.name}<br />{row.protocol}</td><td>{row.model ?? '—'}</td>
          <td>{row.pricingRevision ? 'CNY-v' + row.pricingRevision : t('admin.pricing.unpriced')}</td>
          <td><ActionRow><Button size="small" disabled={row.protocol === 'terminal' || panel.switching} onClick={() => panel.select(row)}>{t('admin.pricing.configure')}</Button>
            <Button size="small" onClick={() => setHistory(row)}>{t('admin.pricing.history')}</Button></ActionRow>
            {row.protocol === 'terminal' ? <p>{t('admin.pricing.unsupported')}</p> : null}</td>
        </tr>)}
      </DataTable> : null}
    </Card>
    <ProjectCostVisibilityManager open={projectsOpen} onClose={() => setProjectsOpen(false)} />
    {panel.target ? <TokenPriceEditor key={panel.sequence} profile={panel.target} open={panel.open} onDirtyChange={panel.dirtyChanged} onClose={panel.hide} onClear={panel.clear} onSaved={panel.close} /> : null}
    {panel.switching ? <ConfirmationDialog question={t('ui.draft.question', { scope: t('admin.pricing.title') })} confirmLabel={t('ui.draft.leave')} cancelLabel={t('ui.draft.stay')} focus="cancel" onConfirm={panel.confirm} onCancel={panel.keep} /> : null}
    {history ? <TokenPriceHistory profile={history} onClose={() => setHistory(undefined)} /> : null}
  </>;
}
