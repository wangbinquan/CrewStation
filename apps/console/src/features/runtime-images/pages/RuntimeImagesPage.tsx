import { CatalogSearch } from '../../../shared/ui/catalog/CatalogSearch';
import { CatalogPagination } from '../../../shared/ui/catalog/CatalogPagination';
import { useState } from 'react';
import { api } from '../../../shared/api/client';
import { AUTO_REFRESH, useApiQuery } from '../../../shared/api/useApi';
import { queryKeys } from '../../../shared/api/queryKeys';
import { useT } from '../../../shared/lib/useT';
import { useProjectScope } from '../../../shared/project/ProjectScope';
import { Card } from '../../../shared/ui/Card';
import { DataTable } from '../../../shared/ui/DataTable';
import { QueryStatus } from '../../../shared/ui/QueryStatus';
import { ImageCatalogRow } from '../components/ImageCatalogRow';
import { ImageDetail } from '../components/ImageDetail';
import { DevelopmentImages } from '../components/DevelopmentImages';
import styles from '../components/RuntimeImages.module.css';
import catalogStyles from '../../../shared/ui/CapabilityCatalog.module.css';

export function RuntimeImagesPage({ selectedImage, onSelectImage, cursor, onPage, search: controlledSearch, onSearch }: { readonly search?: string; readonly onSearch?: (q: string) => void; readonly cursor?: string; readonly onPage?: (cursor?: string) => void; readonly selectedImage?: string; readonly onSelectImage?: (id: string | undefined) => void } = {}) {
  const { projectId } = useProjectScope(), t = useT(), [localSearch, setLocalSearch] = useState('');
  const search = controlledSearch ?? localSearch;
  const [localBefore, setLocalBefore] = useState<string>(), [localSelected, setLocalSelected] = useState<string>();
  const selected = onSelectImage ? selectedImage : localSelected, setSelected = onSelectImage ?? setLocalSelected;
  const before = onPage ? cursor : localBefore, setBefore = onPage ?? setLocalBefore;
  const key = ['runtime-images', projectId];
  const me = useApiQuery(queryKeys.me(), () => api.me.get(), AUTO_REFRESH);
  const role = me.data?.memberships?.find((m) => m.projectId === projectId)?.role;
  const editable = !me.error && (me.data?.isAdmin === true || role === 'owner' || role === 'developer');
  const list = useApiQuery([...key, 'catalog', before, search], () => api.runtimeImages.list(projectId, { before, limit: 30, search }), AUTO_REFRESH);
  const items = [401, 403, 404].includes(list.error?.status ?? 0) || me.error ? [] : list.data?.items ?? [];
  return <div className={styles.stack}>
    <Card compact title={t('images.catalog')}>
      <CatalogSearch key={search} value={search} label={t('images.search')} onSearch={onSearch ?? ((q) => { setLocalSearch(q); setBefore(undefined); })} />
      <QueryStatus isPending={list.isPending} error={list.error} isEmpty={items.length === 0} emptyTitle={t(search ? 'images.noMatches' : 'images.empty')} />
      {items.length ? <DataTable className={catalogStyles.profileTable} columns={[t('images.name'), t('images.latestVersion'), t('images.actions')]}>
        {items.map((image) => <ImageCatalogRow key={image.id} projectId={projectId} image={image} editable={editable} onOpen={() => setSelected(image.id)} />)}
      </DataTable> : null}
      <CatalogPagination scope={`project-images:${projectId}`} userId={me.data?.id} filter={[search, 30]} cursor={before} next={items.length === 30 ? items.at(-1)?.id : undefined} count={list.error || list.isPending ? undefined : items.length} disabled={list.isPending || !!list.error} onChange={setBefore} />
    </Card>
    {selected ? <ImageDetail key={selected} projectId={projectId} imageId={selected} editable={editable} admin={false} manageable={false} onClose={() => setSelected(undefined)} /> : null}
    <DevelopmentImages projectId={projectId} editable={editable} />
  </div>;
}
