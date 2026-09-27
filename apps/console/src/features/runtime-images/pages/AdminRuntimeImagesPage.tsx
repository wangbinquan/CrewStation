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
import { ImageDetail } from '../components/ImageDetail';
import styles from '../components/RuntimeImages.module.css';

export function AdminRuntimeImagesPage() {
  const t = useT(), [before, setBefore] = useState<string>(), [selected, setSelected] = useState<RuntimeImageDto>();
  const { query, me, allowed } = useAdminPage(['runtime-images', 'admin', before], () => api.runtimeImages.adminCatalog({ before, limit: 30 }), true, true);
  return <div className={styles.stack}>
    <PageHeader title={t('images.adminTitle')} description={t('images.adminHint')} />
    <QueryStatus isPending={me.isPending || query.isPending && allowed} error={me.error ?? query.error} />
    {!allowed ? me.isPending ? null : <p>{t('admin.denied.title')}</p> : <>
      <Card title={t('images.catalog')}>
        <DataTable columns={[t('images.name'), t('images.project'), t('images.scope'), t('images.actions')]}>
          {query.data?.items.map((image) => <tr key={image.id}><td>{image.name}</td><td className={styles.identity}>{image.projectId}</td><td>{t(`images.scope.${image.scope}`)}</td><td><Button size="small" onClick={() => setSelected(image)}>{t('images.open')}</Button></td></tr>)}
        </DataTable>
        <div className={styles.row}>{before ? <Button onClick={() => setBefore(undefined)}>{t('images.first')}</Button> : null}{query.data?.items.length === 30 ? <Button onClick={() => setBefore(query.data!.items.at(-1)!.id)}>{t('images.next')}</Button> : null}</div>
      </Card>
      {selected ? <ImageDetail key={selected.id} projectId={selected.projectId} imageId={selected.id} editable admin manageable /> : null}
    </>}
  </div>;
}
