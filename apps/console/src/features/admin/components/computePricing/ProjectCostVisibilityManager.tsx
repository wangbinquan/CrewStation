import { useState } from 'react';
import { ProjectPageSchema, type ProjectDto } from '@crewstation/contracts';
import { api } from '../../../../shared/api/client';
import { useAdminPage } from '../../../../shared/admin/useAdminRead';
import { useDraftTarget } from '../../../../shared/lib/useDraftTarget';
import { useT } from '../../../../shared/lib/useT';
import { Button } from '../../../../shared/ui/Button';
import { DataTable } from '../../../../shared/ui/DataTable';
import { QueryStatus } from '../../../../shared/ui/QueryStatus';
import { CatalogSearch } from '../../../../shared/ui/catalog/CatalogSearch';
import { CatalogPagination } from '../../../../shared/ui/catalog/CatalogPagination';
import { Dialog } from '../../../../shared/ui/dialog/Dialog';
import { ConfirmationDialog } from '../../../../shared/ui/dialog/ConfirmationDialog';
import { ProjectCostVisibilityEditor } from './ProjectCostVisibilityEditor';

/** The directory reads one bounded project page; settings load only on selection. */
export function ProjectCostVisibilityManager({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT(), [q, setQ] = useState(''), [cursor, setCursor] = useState<string>();
  const panel = useDraftTarget<Pick<ProjectDto, 'id' | 'name'>>((a, b) => a.id === b.id);
  const { query, me } = useAdminPage(['admin', 'cost-visibility-projects', q, cursor], async () => {
    const page = ProjectPageSchema.parse(await api.projects.page({ q, limit: 20, ...(cursor ? { cursor } : {}) }));
    if (page.items.length > 20) throw new Error(t('admin.directory.invalid'));
    return page;
  }, open);
  const items = query.error ? [] : query.data?.items ?? [];
  return <>
    {open ? <Dialog size="large" title={t('admin.pricing.visibility.title')} onClose={onClose}>
      <p>{t('admin.pricing.visibility.hint')}</p>
      <CatalogSearch value={q} label={t('admin.pricing.visibility.search')} onSearch={(value) => { setQ(value); setCursor(undefined); }} />
      <QueryStatus isPending={query.isPending} error={query.error} isEmpty={items.length === 0} emptyTitle={t('admin.pricing.visibility.empty')} />
      {items.length ? <DataTable columns={[t('admin.pricing.visibility.project'), t('admin.pricing.actions')]}>
        {items.map(({ project }) => <tr key={project.id}><td>{project.name}<br />{project.slug}</td>
          <td><Button size="small" disabled={panel.switching} onClick={() => panel.select(project)}>{t('admin.pricing.visibility.configure')}</Button></td></tr>)}
      </DataTable> : null}
      <CatalogPagination scope="cost-visibility-projects" userId={me.data?.id} filter={q} cursor={cursor} next={query.data?.nextCursor}
        count={query.error || query.isPending ? undefined : items.length} disabled={query.isPending || !!query.error} onChange={setCursor} />
    </Dialog> : null}
    {panel.target ? <ProjectCostVisibilityEditor key={panel.sequence} project={panel.target} open={open && panel.open} onClose={panel.hide}
      onClear={panel.clear} onSaved={panel.close} onDirtyChange={panel.dirtyChanged} /> : null}
    {open && panel.switching ? <ConfirmationDialog question={t('ui.draft.question', { scope: t('admin.pricing.visibility.title') })} confirmLabel={t('ui.draft.leave')} cancelLabel={t('ui.draft.stay')} focus="cancel" onConfirm={panel.confirm} onCancel={panel.keep} /> : null}
  </>;
}
