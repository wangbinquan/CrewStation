import type { ObservationPrice, ObservationPricingProfile } from '@crewstation/contracts';
import { useState } from 'react';
import { api } from '../../../../shared/api/client';
import { AUTO_REFRESH, useApiQuery } from '../../../../shared/api/useApi';
import { useDateText } from '../../../../shared/lib/useDateText';
import { useDraftTarget } from '../../../../shared/lib/useDraftTarget';
import { useT } from '../../../../shared/lib/useT';
import { ActionRow } from '../../../../shared/ui/ActionRow';
import { Badge } from '../../../../shared/ui/Badge';
import { Button } from '../../../../shared/ui/Button';
import { Card } from '../../../../shared/ui/Card';
import { DataTable } from '../../../../shared/ui/DataTable';
import { QueryStatus } from '../../../../shared/ui/QueryStatus';
import { CatalogSearch } from '../../../../shared/ui/catalog/CatalogSearch';
import { ConfirmationDialog } from '../../../../shared/ui/dialog/ConfirmationDialog';
import { priceBuckets } from '../../model/tokenPriceDraft';
import type { PriceLineTarget } from '../../model/tokenPriceDraft';
import { ProjectCostVisibilityManager } from './ProjectCostVisibilityManager';
import { TokenPriceEditor } from './TokenPriceEditor';
import { TokenPriceHistory } from './TokenPriceHistory';

export const TOKEN_PRICING_QUERY = ['admin', 'token-pricing'] as const;

const sameLine = (a: PriceLineTarget, b: PriceLineTarget) => a.profile.profileId === b.profile.profileId && a.model === b.model;

/** RFC-034 v2：每个算力档位列出配置模型与实际出现过的模型，各自配置人民币单价、查看历史；项目费用可见性在同页开关。 */
export function TokenPricingSection({ search, onSearch }: { search: string; onSearch: (value: string) => void }) {
  const t = useT(), panel = useDraftTarget<PriceLineTarget>(sameLine);
  const [history, setHistory] = useState<{ profile: ObservationPricingProfile; model: string }>(), [projectsOpen, setProjectsOpen] = useState(false);
  const query = useApiQuery(TOKEN_PRICING_QUERY, () => api.observability.pricing(), AUTO_REFRESH);
  const needle = search.trim().toLowerCase();
  const profiles = (query.error ? [] : query.data?.profiles ?? []).filter((profile) => !needle
    || [profile.name, profile.protocol, ...profile.models.map((line) => line.model)].some((value) => value.toLowerCase().includes(needle)));
  return <>
    <Card stacked>
      <p>{t('admin.pricing.hint')}</p>
      <ActionRow><Button onClick={() => setProjectsOpen(true)}>{t('admin.pricing.visibility.title')}</Button></ActionRow>
      <CatalogSearch value={search} label={t('admin.pricing.search')} onSearch={onSearch} />
      <QueryStatus isPending={query.isPending} error={query.error} isEmpty={profiles.length === 0} emptyTitle={t('admin.pricing.empty')} />
      {profiles.length ? <DataTable columns={['name', 'model', 'rates', 'effectiveFrom', 'actions'].map((key) => t('admin.pricing.' + key))}>
        {profiles.map((profile) => <ProfileRows key={profile.profileId} profile={profile} busy={panel.switching}
          configure={(model, current) => panel.select({ profile, model, current })} history={(model) => setHistory({ profile, model })} />)}
      </DataTable> : null}
    </Card>
    <ProjectCostVisibilityManager open={projectsOpen} onClose={() => setProjectsOpen(false)} />
    {panel.target ? <TokenPriceEditor key={panel.sequence} target={panel.target} open={panel.open} onDirtyChange={panel.dirtyChanged} onClose={panel.hide} onClear={panel.clear} onSaved={panel.close} /> : null}
    {panel.switching ? <ConfirmationDialog question={t('ui.draft.question', { scope: t('admin.pricing.title') })} confirmLabel={t('ui.draft.leave')} cancelLabel={t('ui.draft.stay')} focus="cancel" onConfirm={panel.confirm} onCancel={panel.keep} /> : null}
    {history ? <TokenPriceHistory profile={history.profile} model={history.model} onClose={() => setHistory(undefined)} /> : null}
  </>;
}

function ProfileRows({ profile, busy, configure, history }: {
  profile: ObservationPricingProfile; busy: boolean; configure: (model: string | null, current: ObservationPrice | null) => void; history: (model: string) => void;
}) {
  const t = useT(), dateText = useDateText();
  const name = <td rowSpan={Math.max(1, profile.models.length)}>{profile.name}{profile.builtin ? <> <Badge>{t('admin.pricing.builtin')}</Badge></> : null}<br />{profile.protocol}
    <br /><Button size="small" disabled={busy} onClick={() => configure(null, null)}>{t('admin.pricing.addModel')}</Button></td>;
  if (!profile.models.length) return <tr data-price-profile={profile.profileId}>{name}<td colSpan={4}>{t('admin.pricing.noModels')}</td></tr>;
  return <>{profile.models.map((line, index) => <tr key={line.model} data-price-profile={profile.profileId} data-price-model={line.model}>
    {index === 0 ? name : null}
    <td>{line.model}{line.model === profile.configuredModel ? <> <Badge tone="info">{t('admin.pricing.configured')}</Badge></> : null}<br />{t('admin.pricing.calls', { count: line.calls })}</td>
    <td>{line.current ? priceBuckets.map((bucket) => `${t('admin.pricing.' + bucket)} ${line.current!.rates[bucket] === null ? t('admin.pricing.unknownRate') : '¥' + line.current!.rates[bucket]}`).join(' · ') : <Badge tone="warning">{t('admin.pricing.unpriced')}</Badge>}</td>
    <td>{line.current ? dateText(line.current.effectiveFrom) : '—'}</td>
    <td><ActionRow><Button size="small" disabled={busy} onClick={() => configure(line.model, line.current)}>{t('admin.pricing.configure')}</Button>
      <Button size="small" disabled={!line.current} onClick={() => history(line.model)}>{t('admin.pricing.history')}</Button></ActionRow></td>
  </tr>)}</>;
}
