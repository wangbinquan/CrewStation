import { FormField } from '../../../shared/ui/FormField';
import { useState } from 'react';
import { api } from '../../../shared/api/client';
import { AUTO_REFRESH, errorMessage, useApiMutation, useApiQuery } from '../../../shared/api/useApi';
import { queryKeys } from '../../../shared/api/queryKeys';
import { useT } from '../../../shared/lib/useT';
import { useProjectScope } from '../../../shared/project/ProjectScope';
import { Card } from '../../../shared/ui/Card';
import { Button } from '../../../shared/ui/Button';
import { DataTable } from '../../../shared/ui/DataTable';
import { QueryStatus } from '../../../shared/ui/QueryStatus';
import { FormDialog } from '../../../shared/ui/dialog/FormDialog';
import { ImageDetail } from '../components/ImageDetail';
import { DevelopmentImages } from '../components/DevelopmentImages';
import styles from '../components/RuntimeImages.module.css';

export function RuntimeImagesPage() {
  const { projectId } = useProjectScope(), t = useT();
  const [before, setBefore] = useState<string>(), [selected, setSelected] = useState<string>();
  const [adding, setAdding] = useState(false), [name, setName] = useState('');
  const key = ['runtime-images', projectId];
  const me = useApiQuery(queryKeys.me(), () => api.me.get(), AUTO_REFRESH);
  const role = me.data?.memberships?.find((m) => m.projectId === projectId)?.role;
  const editable = !me.error && (me.data?.isAdmin === true || role === 'owner' || role === 'developer');
  const list = useApiQuery([...key, 'catalog', before], () => api.runtimeImages.list(projectId, { before, limit: 30 }), AUTO_REFRESH);
  const create = useApiMutation(() => api.runtimeImages.create(projectId, { name: name.trim(), description: '' }), { invalidate: [key], onSuccess: (image) => { setSelected(image.id); setAdding(false); setName(''); } });
  return <div className={styles.stack}>
    <p className={styles.note}>{t('images.intro')}</p>
    <Card title={t('images.catalog')} extra={editable ? <Button variant="primary" onClick={() => setAdding(true)}>{t('images.add')}</Button> : null}>
      <QueryStatus isPending={list.isPending} error={list.error} isEmpty={list.data?.items.length === 0} emptyTitle={t('images.empty')} />
      {list.data?.items.length ? <DataTable columns={[t('images.name'), t('images.scope'), t('images.state'), t('images.actions')]}>
        {list.data.items.map((image) => <tr key={image.id}><td>{image.name}</td><td>{t(`images.scope.${image.scope}`)}</td><td>{t(image.enabled ? 'images.enabled' : 'images.disabled')}</td><td><Button size="small" onClick={() => setSelected(image.id)}>{t('images.open')}</Button></td></tr>)}
      </DataTable> : null}
      <div className={styles.row}>
        {before ? <Button onClick={() => setBefore(undefined)}>{t('images.first')}</Button> : null}
        {list.data?.items.length === 30 ? <Button onClick={() => setBefore(list.data!.items.at(-1)!.id)}>{t('images.next')}</Button> : null}
      </div>
    </Card>
    {selected ? <ImageDetail key={selected} projectId={projectId} imageId={selected} editable={editable} admin={!!me.data?.isAdmin} manageable={!me.error && (me.data?.isAdmin === true || role === 'owner')} /> : null}
    <DevelopmentImages projectId={projectId} editable={editable} />
    {adding ? <FormDialog title={t('images.add')} submitLabel={t('images.create')} onClose={() => setAdding(false)} onSubmit={() => create.mutate()} busy={create.isPending} submitDisabled={!name.trim()} error={create.error ? errorMessage(create.error) : undefined} dirty={!!name} onClear={() => setName('')}>
      <FormField label={t('images.name')}><input value={name} maxLength={80} onChange={(event) => setName(event.target.value)} /></FormField>
    </FormDialog> : null}
  </div>;
}
