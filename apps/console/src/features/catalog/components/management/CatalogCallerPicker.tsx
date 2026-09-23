import { useState } from 'react';
import { useT } from '../../../../shared/lib/useT';
import { Card } from '../../../../shared/ui/Card';
import { Button } from '../../../../shared/ui/Button';
import { FormField } from '../../../../shared/ui/FormField';
import { QueryStatus } from '../../../../shared/ui/QueryStatus';
import { EmptyState } from '../../../../shared/ui/EmptyState';
import type { useCatalogCaller } from '../../hooks/useCatalogCaller';
import styles from './CatalogCallerPicker.module.css';

export function CatalogCallerPicker({ data, projectId, q, cursor, onChange, onSearch }: {
  readonly data: ReturnType<typeof useCatalogCaller>; readonly projectId?: string; readonly q?: string; readonly cursor?: string;
  readonly onChange: (id?: string) => void; readonly onSearch: (q: string, cursor?: string) => void;
}) {
  const t = useT(), [draft, setDraft] = useState(q ?? '');
  const items = data.list.error ? [] : data.list.data?.items ?? [], selected = data.selected.error ? undefined : data.project;
  // 换页、搜索时（查询键变了）才禁用入口；例行重读（每 30 秒）不禁用，入口不闪。
  const loading = data.list.isPending;
  return <Card compact title={t('catalog.admin.scopeTitle')} footer={t('catalog.caller.hint')}>
    <form role="search" className={styles.filters} onSubmit={(e) => { e.preventDefault(); if (!loading) onSearch(draft.trim()); }}>
      <FormField label={t('catalog.caller.search')}><input aria-label={t('catalog.caller.search')} value={draft} maxLength={120} onChange={(e) => setDraft(e.target.value)} /></FormField>
      <Button type="submit" disabled={loading}>{t('catalog.caller.find')}</Button>
      <Button disabled={loading} onClick={() => { setDraft(''); onSearch(''); }}>{t('catalog.caller.clearSearch')}</Button>
    </form>
    <FormField label={t('catalog.caller.select')} hint={t('catalog.admin.scopeHint')}><select aria-label={t('catalog.caller.select')} value={projectId ?? ''} disabled={loading || !!data.list.error} onChange={(e) => onChange(e.target.value || undefined)}>
      <option value="">{t('catalog.admin.allOperations')}</option>
      {projectId && !items.some((item) => item.project.id === projectId) ? <option value={projectId}>{selected ? `${selected.name} · ${selected.slug}` : projectId}</option> : null}
      {items.map(({ project }) => <option key={project.id} value={project.id}>{project.name} · {project.slug}</option>)}
    </select></FormField>
    <QueryStatus isPending={data.list.isPending} error={data.list.error} />
    {!data.list.isPending && !data.list.error && items.length === 0 ? <p>{t('catalog.caller.noMatches')}</p> : null}
    <div className={styles.toolbar}><span>{!data.list.isPending && !data.list.error ? t('catalog.caller.count', { count: items.length }) : t('catalog.caller.countUnknown')}</span>
      <div className={styles.filters}>{cursor ? <Button disabled={loading} onClick={() => onSearch(q ?? '')}>{t('catalog.caller.first')}</Button> : null}
        <Button disabled={loading || !!data.list.error || !data.list.data?.nextCursor} onClick={() => onSearch(q ?? '', data.list.data?.nextCursor)}>{t('catalog.caller.next')}</Button></div></div>
    {projectId ? <div className={styles.selected}>{data.selected.error?.status === 404 ? <EmptyState title={t('catalog.admin.unknownProject')} description={projectId} /> : <QueryStatus isPending={data.selected.isPending} error={data.selected.error} />}
      {selected?.serviceId ? <p>{t('catalog.admin.currentService')} <strong>{selected.name}</strong> · <code>{selected.serviceId}</code></p> : null}
      {selected && !selected.serviceId ? <EmptyState title={t('catalog.service.missingTitle')} description={t('catalog.service.missingDescription')} /> : null}
      <Button variant="ghost" onClick={() => onChange(undefined)}>{t('catalog.caller.clearSelection')}</Button></div> : null}
  </Card>;
}
