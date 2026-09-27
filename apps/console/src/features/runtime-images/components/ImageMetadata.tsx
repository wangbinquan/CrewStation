import type { RuntimeImageDto } from '@crewstation/contracts';
import { useState } from 'react';
import { api } from '../../../shared/api/client';
import { errorMessage, useApiMutation } from '../../../shared/api/useApi';
import { useT } from '../../../shared/lib/useT';
import { Button } from '../../../shared/ui/Button';
import { FormField } from '../../../shared/ui/FormField';
import { ImageActionConfirmation } from './ImageActionConfirmation';
import { Dialog } from '../../../shared/ui/dialog/Dialog';
import { FormDialog } from '../../../shared/ui/dialog/FormDialog';
import styles from './RuntimeImages.module.css';

export function ImageMetadata({ projectId, image, editable, manageable }: { readonly projectId: string | undefined; readonly image: RuntimeImageDto; readonly editable: boolean; readonly manageable: boolean }) {
  const t = useT(), [editing, setEditing] = useState(false), [draft, setDraft] = useState<Pick<RuntimeImageDto, 'name' | 'description' | 'revision'>>();
  const save = useApiMutation(() => api.runtimeImages.update(projectId, image.id, { name: draft!.name, description: draft!.description, expectedRevision: draft!.revision }), { invalidate: [['runtime-images', projectId]], onSuccess: () => { setEditing(false); setDraft(undefined); } });
  const [technical, setTechnical] = useState(false);
  const [pending, setPending] = useState<RuntimeImageDto>();
  const toggle = useApiMutation(() => api.runtimeImages.update(projectId, pending!.id, { enabled: !pending!.enabled, expectedRevision: pending!.revision }), { invalidate: [['runtime-images', projectId]], onSuccess: () => setPending(undefined) });
  return <div className={styles.stack}><p>{image.description || t('images.noDescription')}</p><div className={styles.row}>
    {editable ? <Button onClick={() => { setDraft((current) => current ?? { name: image.name, description: image.description, revision: image.revision }); setEditing(true); }}>{t('images.editMetadata')}</Button> : null}
    </div><h3>{t('images.availability')}</h3><p>{t(image.enabled ? 'images.enabled' : 'images.disabled')}</p><p>{t('images.disableHint')}</p><div className={styles.row}>
    {manageable ? <Button variant={image.enabled ? "danger" : "secondary"} onClick={() => { toggle.reset(); setPending({ ...image }); }} disabled={toggle.isPending}>{t(image.enabled ? 'images.disableImage' : 'images.enableImage')}</Button> : null}</div>
    {pending ? <ImageActionConfirmation title={t(pending.enabled ? 'images.disableImage' : 'images.enableImage')} target={<strong>{pending.name}</strong>} hint={t(pending.enabled ? 'images.confirmDisableImage' : 'images.confirmEnableImage')} danger={pending.enabled} busy={toggle.isPending} error={toggle.error} onCancel={() => setPending(undefined)} onConfirm={() => toggle.mutate()} /> : null}
    <div><Button size="small" onClick={() => setTechnical(true)}>{t('images.technicalDetails')}</Button></div>
    {technical ? <Dialog title={t('images.technicalDetails')} onClose={() => setTechnical(false)}><p>{image.name}</p><p className={styles.identity}>{image.id}</p></Dialog> : null}
    {editing && draft ? <FormDialog title={t('images.editMetadata')} submitLabel={t('images.save')} onClose={() => setEditing(false)} onSubmit={() => save.mutate()} busy={save.isPending} submitDisabled={!draft.name.trim()} error={save.error ? errorMessage(save.error) : undefined}>
      <FormField label={t('images.name')}><input value={draft.name} maxLength={80} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></FormField>
      <FormField label={t('images.description')}><textarea value={draft.description} maxLength={1000} onChange={(e) => setDraft({ ...draft, description: e.target.value })} /></FormField>
    </FormDialog> : null}</div>;
}
