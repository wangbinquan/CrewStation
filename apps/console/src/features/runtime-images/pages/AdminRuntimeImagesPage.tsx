import { CatalogSearch } from '../../../shared/ui/catalog/CatalogSearch';
import { CatalogPagination } from '../../../shared/ui/catalog/CatalogPagination';
import { useState } from 'react';
import { api } from '../../../shared/api/client';
import { useAdminPage } from '../../../shared/admin/useAdminRead';
import { useT } from '../../../shared/lib/useT';
import { Button } from '../../../shared/ui/Button';
import { Card } from '../../../shared/ui/Card';
import { DataTable } from '../../../shared/ui/DataTable';
import { PageHeader } from '../../../shared/ui/PageHeader';
import { QueryStatus } from '../../../shared/ui/QueryStatus';
import { CreateImageDialog } from '../components/CreateImageDialog';
import { ImageCatalogRow } from '../components/ImageCatalogRow';
import { ImageDetail } from '../components/ImageDetail';
import styles from '../components/RuntimeImages.module.css';
import catalogStyles from '../../../shared/ui/CapabilityCatalog.module.css';

export function AdminRuntimeImagesPage({ filter: controlled, onChange }: { readonly filter?: { readonly q?: string; readonly before?: string }; readonly onChange?: (q: string, before?: string) => void }) {
  const t = useT(), [local, setLocal] = useState<{ q?: string; before?: string }>({});
  const filter = controlled ?? local, before = filter.before, search = filter.q ?? '';
  const change = onChange ?? ((q: string, before?: string) => setLocal({ q, before }));
  const [selected, setSelected] = useState<string>(), [adding, setAdding] = useState(false);
  const { query, me, allowed } = useAdminPage(['runtime-images', undefined, 'admin', before, search], () => api.runtimeImages.adminCatalog({ before, limit: 30, search }), true, true);
  const items = [401, 403, 404].includes(query.error?.status ?? 0) ? [] : query.data?.items ?? [];
  return <div className={styles.stack}>
    <PageHeader title={t('images.adminTitle')} />
    <QueryStatus isPending={me.isPending || query.isPending && allowed} error={me.error ?? query.error} />
    {!allowed ? me.isPending ? null : <p>{t('admin.denied.title')}</p> : <>
      <Card compact>
        <CatalogSearch key={search} value={search} label={t('images.search')} onSearch={(q) => change(q)} actions={<Button variant="primary" onClick={() => setAdding(true)}>{t('images.add')}</Button>} />
        <QueryStatus isPending={query.isPending} error={query.error} isEmpty={items.length === 0} emptyTitle={t(search ? 'images.noMatches' : 'images.empty')} />
        {items.length ? <DataTable className={catalogStyles.profileTable} columns={[t('images.name'), t('images.latestVersion'), t('images.latestBuild'), t('images.actions')]}>
          {items.map((image) => <ImageCatalogRow key={image.id} image={image} projectId={undefined} editable onOpen={() => setSelected(image.id)} />)}
        </DataTable> : null}
        <CatalogPagination scope="admin-images" userId={me.data?.id} filter={[search, 30]} cursor={before} next={items.length === 30 ? items.at(-1)?.id : undefined} count={query.error || query.isPending ? undefined : items.length} disabled={query.isPending || !!query.error} onChange={(cursor) => change(search, cursor)} />
      </Card>
      {selected ? <ImageDetail key={selected} projectId={undefined} imageId={selected} editable admin manageable onClose={() => setSelected(undefined)} /> : null}
      <CreateImageDialog projectId={undefined} open={adding} onClose={() => setAdding(false)} onCreated={(id) => { setSelected(id); setAdding(false); }} />
    </>}
  </div>;
}
