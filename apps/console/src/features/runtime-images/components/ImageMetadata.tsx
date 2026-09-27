import type { RuntimeImageDto } from '@crewstation/contracts';
import { useState } from 'react';
import { api } from '../../../shared/api/client';
import { errorMessage, useApiMutation } from '../../../shared/api/useApi';
import { useT } from '../../../shared/lib/useT';
import { Button } from '../../../shared/ui/Button';
import { FormField } from '../../../shared/ui/FormField';
import { ActionNote } from '../../../shared/ui/ActionNote';
import { FormDialog } from '../../../shared/ui/dialog/FormDialog';
import styles from './RuntimeImages.module.css';

export function ImageMetadata({ projectId, image, editable, manageable }: { readonly projectId: string; readonly image: RuntimeImageDto; readonly editable: boolean; readonly manageable: boolean }) {
  const t = useT(), [editing, setEditing] = useState(false), [name, setName] = useState(image.name), [description, setDescription] = useState(image.description), [revision] = useState(image.revision);
  const save = useApiMutation(() => api.runtimeImages.update(projectId, image.id, { name, description, expectedRevision: revision }), { invalidate: [['runtime-images', projectId]], onSuccess: () => setEditing(false) });
  const toggle = useApiMutation(() => api.runtimeImages.update(projectId, image.id, { enabled: !image.enabled, expectedRevision: image.revision }), { invalidate: [['runtime-images', projectId]] });
  return <div className={styles.stack}><p>{image.description || t('images.noDescription')}</p><p>{t('images.disableHint')}</p><div className={styles.row}>
    {editable ? <Button onClick={() => setEditing(true)}>{t('images.editMetadata')}</Button> : null}
    {manageable ? <Button onClick={() => toggle.mutate()} disabled={toggle.isPending}>{t(image.enabled ? 'images.disableImage' : 'images.enableImage')}</Button> : null}</div>
    {toggle.error ? <ActionNote tone="error">{errorMessage(toggle.error)}</ActionNote> : null}
    <details><summary>{t('images.technicalDetails')}</summary><p className={styles.identity}>{image.id}</p></details>
    {editing ? <FormDialog title={t('images.editMetadata')} submitLabel={t('images.save')} onClose={() => setEditing(false)} onSubmit={() => save.mutate()} busy={save.isPending} error={save.error ? errorMessage(save.error) : undefined}>
      <FormField label={t('images.name')}><input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} /></FormField>
      <FormField label={t('images.description')}><textarea value={description} maxLength={1000} onChange={(e) => setDescription(e.target.value)} /></FormField>
    </FormDialog> : null}</div>;
}
