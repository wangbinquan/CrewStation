import { useState } from 'react';
import { api } from '../../../shared/api/client';
import { AUTO_REFRESH, useApiQuery } from '../../../shared/api/useApi';
import { queryKeys } from '../../../shared/api/queryKeys';
import { useT } from '../../../shared/lib/useT';
import { useProjectScope } from '../../../shared/project/ProjectScope';
import { Card } from '../../../shared/ui/Card';
import { Button } from '../../../shared/ui/Button';
import { DataTable } from '../../../shared/ui/DataTable';
import { QueryStatus } from '../../../shared/ui/QueryStatus';
import { CreateImageDialog } from '../components/CreateImageDialog';
import { ImageCatalogRow } from '../components/ImageCatalogRow';
import { ImageDetail } from '../components/ImageDetail';
import { DevelopmentImages } from '../components/DevelopmentImages';
import styles from '../components/RuntimeImages.module.css';

export function RuntimeImagesPage({ selectedImage, onSelectImage }: { readonly selectedImage?: string; readonly onSelectImage?: (id: string | undefined) => void } = {}) {
  const { projectId } = useProjectScope(), t = useT();
  const [before, setBefore] = useState<string>(), [localSelected, setLocalSelected] = useState<string>();
  const selected = onSelectImage ? selectedImage : localSelected, setSelected = onSelectImage ?? setLocalSelected;
  const [adding, setAdding] = useState(false);
  const key = ['runtime-images', projectId];
  const me = useApiQuery(queryKeys.me(), () => api.me.get(), AUTO_REFRESH);
  const role = me.data?.memberships?.find((m) => m.projectId === projectId)?.role;
  const editable = !me.error && (me.data?.isAdmin === true || role === 'owner' || role === 'developer');
  const list = useApiQuery([...key, 'catalog', before], () => api.runtimeImages.list(projectId, { before, limit: 30 }), AUTO_REFRESH);
  return <div className={styles.stack}>
    <p className={styles.note}>{t('images.intro')}</p>
    <Card title={t('images.catalog')} extra={editable ? <Button variant="primary" onClick={() => setAdding(true)}>{t('images.add')}</Button> : null}>
      <QueryStatus isPending={list.isPending} error={list.error} isEmpty={list.data?.items.length === 0} emptyTitle={t('images.empty')} />
      {list.data?.items.length ? <DataTable columns={[t('images.name'), t('images.latestVersion'), t('images.latestBuild'), t('images.actions')]}>
        {list.data.items.map((image) => <ImageCatalogRow key={image.id} projectId={projectId} image={image} editable={editable} onOpen={() => setSelected(image.id)} />)}
      </DataTable> : null}
      <div className={styles.row}>
        {before ? <Button onClick={() => setBefore(undefined)}>{t('images.first')}</Button> : null}
        {list.data?.items.length === 30 ? <Button onClick={() => setBefore(list.data!.items.at(-1)!.id)}>{t('images.next')}</Button> : null}
      </div>
    </Card>
    {selected ? <ImageDetail key={selected} projectId={projectId} imageId={selected} editable={editable} admin={!!me.data?.isAdmin} manageable={!me.error && (me.data?.isAdmin === true || role === 'owner')} onClose={() => setSelected(undefined)} /> : null}
    <DevelopmentImages projectId={projectId} editable={editable} />
    <CreateImageDialog projectId={projectId} open={adding} onClose={() => setAdding(false)} onCreated={(id) => { setSelected(id); setAdding(false); }} />
  </div>;
}
