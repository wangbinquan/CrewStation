import type { RuntimeImageDto } from '@crewstation/contracts';
import { useState } from 'react';
import { api } from '../../../shared/api/client';
import { useAdminPage } from '../../../shared/admin/useAdminRead';
import { useT } from '../../../shared/lib/useT';
import { Button } from '../../../shared/ui/Button';
import { Card } from '../../../shared/ui/Card';
import { DataTable } from '../../../shared/ui/DataTable';
import { PageHeader } from '../../../shared/ui/PageHeader';
import { QueryStatus } from '../../../shared/ui/QueryStatus';
import { FormField } from '../../../shared/ui/FormField';
import { AUTO_REFRESH, useApiQuery } from '../../../shared/api/useApi';
import { CreateImageDialog } from '../components/CreateImageDialog';
import { ImageCatalogRow } from '../components/ImageCatalogRow';
import { ImageDetail } from '../components/ImageDetail';
import styles from '../components/RuntimeImages.module.css';

export function AdminRuntimeImagesPage() {
  const t = useT(), [before, setBefore] = useState<string>(), [selected, setSelected] = useState<Pick<RuntimeImageDto, 'id' | 'projectId'>>(), [projectId, setProjectId] = useState(''), [adding, setAdding] = useState(false);
  const { query, me, allowed } = useAdminPage(['runtime-images', 'admin', before], () => api.runtimeImages.adminCatalog({ before, limit: 30 }), true, true);
  const projects = useApiQuery(['runtime-images', 'admin-projects'], () => api.projects.list(), { ...AUTO_REFRESH, enabled: allowed });
  return <div className={styles.stack}>
    <PageHeader title={t('images.adminTitle')} description={t('images.adminHint')} />
    <QueryStatus isPending={me.isPending || query.isPending && allowed} error={me.error ?? query.error} />
    {!allowed ? me.isPending ? null : <p>{t('admin.denied.title')}</p> : <>
      <Card title={t('images.add')}><div className={styles.row}><FormField label={t('images.creationProject')}><select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
        <option value="">{t('images.chooseProject')}</option>{projects.data?.items.filter((p) => p.state === 'active').map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></FormField>
        <Button variant="primary" disabled={!projectId || !!projects.error} onClick={() => setAdding(true)}>{t('images.add')}</Button></div><p>{t('images.projectRequired')}</p><QueryStatus isPending={projects.isPending} error={projects.error} /></Card>
      <Card title={t('images.catalog')}>
        <DataTable columns={[t('images.name'), t('images.latestVersion'), t('images.latestBuild'), t('images.actions')]}>
          {query.data?.items.map((image) => <ImageCatalogRow key={image.id} image={image} projectId={image.projectId} projectName={projects.data?.items.find((p) => p.id === image.projectId)?.name ?? t('images.projectNumber', { id: image.projectId.slice(-12) })} editable onOpen={() => setSelected(image)} />)}
        </DataTable>
        <div className={styles.row}>{before ? <Button onClick={() => setBefore(undefined)}>{t('images.first')}</Button> : null}{query.data?.items.length === 30 ? <Button onClick={() => setBefore(query.data!.items.at(-1)!.id)}>{t('images.next')}</Button> : null}</div>
      </Card>
      {selected ? <ImageDetail key={selected.id} projectId={selected.projectId} imageId={selected.id} editable admin manageable onClose={() => setSelected(undefined)} /> : null}
      {projectId ? <CreateImageDialog key={projectId} projectId={projectId} open={adding} onClose={() => setAdding(false)} onCreated={(id) => { setSelected({ id, projectId }); setAdding(false); }} /> : null}
    </>}
  </div>;
}
