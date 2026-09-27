import { useRef, useState } from 'react';
import type { ProjectRuntimeImagePolicy, ProjectRuntimeImagePolicyDto, RuntimeImageDto } from '@crewstation/contracts';
import { api } from '../../../../shared/api/client';
import { errorMessage, useApiMutation } from '../../../../shared/api/useApi';
import { useT } from '../../../../shared/lib/useT';
import { UnsavedChangesGuard } from '../../../../shared/navigation/UnsavedChangesGuard';
import { ActionNote } from '../../../../shared/ui/ActionNote';
import { ActionRow } from '../../../../shared/ui/ActionRow';
import { Button } from '../../../../shared/ui/Button';
import { Card } from '../../../../shared/ui/Card';
import { FormField } from '../../../../shared/ui/FormField';
import { ConfirmationDialog } from '../../../../shared/ui/dialog/ConfirmationDialog';
import { Stack } from '../../../../shared/ui/Stack';
import styles from './ProjectComputeForm.module.css';

/** 业务资源页与算力授权并列；只配置使用范围，镜像生命周期留在平台目录。 */
export function ProjectRuntimeImageForm({ initial, images, viewerId, onReload }: {
  readonly initial: ProjectRuntimeImagePolicyDto; readonly images: readonly RuntimeImageDto[];
  readonly viewerId: string; readonly onReload: () => void;
}) {
  const t = useT(), [base, setBase] = useState(initial), [draft, setDraft] = useState(initial.policy), [discarding, setDiscarding] = useState(false), [saved, setSaved] = useState(false);
  const lock = useRef(false);
  const policy: ProjectRuntimeImagePolicy = draft.mode === 'inherit' ? { mode: 'inherit', allowedImageIds: [] } : draft;
  const dirty = JSON.stringify(policy) !== JSON.stringify(base.policy);
  const save = useApiMutation(async () => {
    const me = await api.me.get();
    if (!me.isAdmin || me.id !== viewerId) throw new Error(t('admin.projectCompute.identityChanged'));
    return api.runtimeImages.saveProjectPolicy(initial.projectId, { expectedRevision: base.revision, policy });
  }, { invalidate: [['runtime-images', initial.projectId]], onSuccess: (next) => { setBase(next); setDraft(next.policy); setSaved(true); } });
  const change = (patch: Partial<ProjectRuntimeImagePolicy>) => { setDraft((value) => ({ ...value, ...patch })); setSaved(false); };
  const submit = () => {
    if (lock.current || !dirty) return;
    lock.current = true; setSaved(false); save.mutate(undefined, { onSettled: () => { lock.current = false; } });
  };
  const known = new Set(images.map((image) => image.id));
  return <Card stacked title={t('admin.projectImages.title')} footer={t('admin.projectImages.effect')}>
    <UnsavedChangesGuard dirty={dirty || save.isPending} scope={t('admin.projectImages.title')} isNavigationBusy={() => save.isPending} />
    <form onSubmit={(event) => { event.preventDefault(); submit(); }}><Stack>
      <FormField label={t('admin.projectImages.mode')} hint={t('admin.projectImages.modeHint')}><select value={draft.mode} disabled={save.isPending} onChange={(event) => change({ mode: event.target.value as ProjectRuntimeImagePolicy['mode'] })}>
        <option value="inherit">{t('admin.projectImages.inherit')}</option><option value="restricted">{t('admin.projectCompute.restricted')}</option>
      </select></FormField>
      {draft.mode === 'restricted' ? <fieldset className={styles.profiles} disabled={save.isPending}><legend>{t('admin.projectImages.allowed')}</legend>
        <p>{t('admin.projectImages.allowedHint')}</p>
        {images.map((image) => <label key={image.id} className={styles.choice}><input type="checkbox" checked={draft.allowedImageIds.includes(image.id)} onChange={(event) => change({ allowedImageIds: event.target.checked ? [...draft.allowedImageIds, image.id] : draft.allowedImageIds.filter((id) => id !== image.id) })} />
          <span><strong>{image.name}</strong><small>{image.description}{!image.enabled ? ` · ${t('admin.projectImages.disabled')}` : ''}</small></span></label>)}
        {draft.allowedImageIds.filter((id) => !known.has(id)).map((id) => <label key={id} className={styles.choice}><input type="checkbox" checked onChange={() => change({ allowedImageIds: draft.allowedImageIds.filter((value) => value !== id) })} /><span>{t('admin.projectImages.missing', { id })}</span></label>)}
      </fieldset> : <ActionNote tone="neutral">{t('admin.projectImages.inherited')}</ActionNote>}
      {save.error ? <ActionNote tone="error">{errorMessage(save.error)}</ActionNote> : null}{saved ? <ActionNote tone="success">{t('admin.projectImages.saved')}</ActionNote> : null}
      <ActionRow><Button type="submit" variant="primary" disabled={save.isPending || !dirty}>{t(save.isPending ? 'admin.profile.working' : 'admin.projectImages.save')}</Button>
        {dirty ? <Button variant="ghost" disabled={save.isPending} onClick={() => setDiscarding(true)}>{t('admin.projectImages.discard')}</Button> : null}
      </ActionRow>
    </Stack></form>
    {discarding ? <ConfirmationDialog title={t('admin.projectImages.discard')} question={t('admin.projectImages.discardHint')} onCancel={() => setDiscarding(false)} onConfirm={onReload} confirmLabel={t('admin.projectImages.reload')} /> : null}
  </Card>;
}
