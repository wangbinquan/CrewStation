import { ActionNote } from '../../../../shared/ui/ActionNote';
import { useState } from 'react';
import { useT } from '../../../../shared/lib/useT';
import { useDraftTarget } from '../../../../shared/lib/useDraftTarget';
import { useApiQuery } from '../../../../shared/api/useApi';
import { Button } from '../../../../shared/ui/Button';
import { Card } from '../../../../shared/ui/Card';
import { DataTable } from '../../../../shared/ui/DataTable';
import { QueryStatus } from '../../../../shared/ui/QueryStatus';
import { ConfirmationDialog } from '../../../../shared/ui/dialog/ConfirmationDialog';
import { CatalogCell } from '../../../../shared/ui/catalog/CatalogCell';
import { CatalogSearch } from '../../../../shared/ui/catalog/CatalogSearch';
import styles from '../../../../shared/ui/CapabilityCatalog.module.css';
import { resourceCatalogAccess } from '../../model/resourceCatalogAccess';
import type { ResourceCatalogEntry, ResourceCatalogKind } from '../../model/resourceCatalogDraft';
import { ResourceCatalogEditor } from './ResourceCatalogEditor';

export function ResourceCatalogSection({ kind, search, onSearch }: { readonly kind: ResourceCatalogKind; readonly search?: string; readonly onSearch?: (q: string) => void }) {
  const [saved, setSaved] = useState<ResourceCatalogEntry>();
  const t = useT(), [local, setLocal] = useState(''), q = search ?? local;
  const panel = useDraftTarget<ResourceCatalogEntry | 'new'>((a, b) => a === 'new' || b === 'new' ? a === b : a.id === b.id);
  const prefix = kind === 'service' ? 'plans' : 'profiles', access = resourceCatalogAccess(kind, t('admin.resource.invalidRead'), t('admin.resource.invalidWrite'));
  const query = useApiQuery(access.key, access.read), unavailable = query.isPending || query.isError;
  const items = [401, 403, 404].includes(query.error?.status ?? 0) ? [] : query.data?.items ?? [];
  const matching = items.filter((item) => [item.name, item.description].some((value) => value?.toLowerCase().includes(q.toLowerCase())));
  const fields = ['name', 'cpu', 'memory', kind === 'service' ? 'maxReplicas' : 'storage'];
  return <Card compact>
    <CatalogSearch key={q} value={q} label={t('catalog.searchDescription')} onSearch={onSearch ?? setLocal} actions={<Button variant="primary" disabled={panel.switching} onClick={() => panel.select('new')}>{t('admin.resource.new', { kind: t(`admin.resource.${kind}`) })}</Button>} />
    {saved ? <ActionNote tone="success">{t('admin.resource.saved', { kind: t(`admin.resource.${kind}`), name: saved.name })} {t(`admin.${prefix}.hint`)}</ActionNote> : null}
    <QueryStatus isPending={query.isPending} error={query.error} isEmpty={matching.length === 0} emptyTitle={t(q ? 'catalog.noMatches' : `admin.${prefix}.emptyTitle`)} emptyDescription={t(q ? 'catalog.noMatchesHint' : `admin.${prefix}.emptyDescription`)} />
    {matching.length ? <DataTable className={styles.catalogTable} columns={fields.map((field) => t(`admin.${prefix}.${field}`)).concat(t('admin.resource.actions'))}>{matching.map((entry) => <tr key={entry.id}>
      <td><div className={styles.identity}><strong>{entry.name}</strong>{entry.description ? <p className={styles.description}>{entry.description}</p> : null}</div></td>
      <CatalogCell label={t(`admin.${prefix}.cpu`)}>{entry.cpu}</CatalogCell><CatalogCell label={t(`admin.${prefix}.memory`)}>{entry.memory}</CatalogCell>
      <CatalogCell label={t(`admin.${prefix}.${kind === 'service' ? 'maxReplicas' : 'storage'}`)}>{'maxReplicas' in entry ? entry.maxReplicas : entry.storage}</CatalogCell>
      <td><Button size="small" disabled={unavailable || panel.switching} onClick={() => panel.select(entry)}>{t('admin.resource.edit')}</Button></td>
    </tr>)}</DataTable> : null}
    {!unavailable ? <p className={styles.hint}>{t('catalog.resultCount', { count: matching.length })}</p> : null}
    {panel.switching ? <ConfirmationDialog question={t('ui.draft.question', { scope: t(`admin.resource.${kind}`) })} confirmLabel={t('ui.draft.leave')} cancelLabel={t('ui.draft.stay')} focus="cancel" onConfirm={panel.confirm} onCancel={panel.keep} /> : null}
    {panel.hasDraft ? <ResourceCatalogEditor key={panel.sequence} kind={kind} initial={panel.target === 'new' ? undefined : panel.target} open={panel.open} onDirty={panel.dirtyChanged} onClose={panel.hide} onSaved={(entry) => { setSaved(entry); panel.close(); }} /> : null}
  </Card>;
}
