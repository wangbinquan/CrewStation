import type { AppIcon, AppPresentationDto, SetAppPresentationRequest } from '@crewstation/contracts';
import { useId, useState } from 'react';
import { api } from '../../../../shared/api/client';
import { errorMessage, useApiMutation } from '../../../../shared/api/useApi';
import { useT } from '../../../../shared/lib/useT';
import { ActionNote } from '../../../../shared/ui/ActionNote';
import { Button } from '../../../../shared/ui/Button';
import { FormField } from '../../../../shared/ui/FormField';
import { GlyphIcon } from '../../../../shared/ui/icons/GlyphIcon';
import styles from './Visibility.module.css';

export function AppPresentationForm({ projectId, saved, canConfigure, reload }: { readonly projectId: string; readonly saved: AppPresentationDto; readonly canConfigure: boolean; readonly reload: () => Promise<unknown> }) {
  const t = useT(), id = useId(), [draft, setDraft] = useState(saved), [base, setBase] = useState(saved), [invalid, setInvalid] = useState(false);
  const dirty = draft.description !== base.description || draft.icon !== base.icon;
  if (!dirty && saved.revision > base.revision) { setDraft(saved); setBase(saved); }
  const save = useApiMutation((input: SetAppPresentationRequest) => api.projects.setAppPresentation(projectId, input), { invalidate: [['market']], onSuccess: (value) => { setDraft(value); setBase(value); void reload(); } });
  const conflict = saved.revision > base.revision;
  if (!canConfigure) return <div className={styles.person}><GlyphIcon name={saved.icon} /><p>{saved.description || t('projects.visibility.noDescription')}</p></div>;
  return <form className={styles.stack} noValidate onSubmit={(event) => {
    event.preventDefault(); if (draft.description.trim().length > 400) { setInvalid(true); return; }
    setInvalid(false); save.mutate({ description: draft.description, icon: draft.icon, expectedRevision: base.revision }, { onError: () => { void reload(); } });
  }}>
    <FormField label={t('projects.visibility.description')} hint={t('projects.visibility.descriptionHint')} hintId={`${id}-hint`} error={invalid ? t('projects.visibility.descriptionTooLong') : undefined} errorId={`${id}-error`}>
      <textarea rows={3} value={draft.description} disabled={save.isPending} aria-invalid={invalid} aria-describedby={`${id}-hint${invalid ? ` ${id}-error` : ''}`} onChange={(event) => { setDraft({ ...draft, description: event.target.value }); save.reset(); setInvalid(false); }} />
    </FormField>
    <div className={styles.iconChoice}><GlyphIcon name={draft.icon} /><FormField label={t('projects.visibility.icon')}><select disabled={save.isPending} value={draft.icon} onChange={(event) => { setDraft({ ...draft, icon: event.target.value as AppIcon }); save.reset(); }}>
      {(['station', 'assistant', 'workflow', 'book', 'chart', 'spark'] as const).map((icon) => <option key={icon} value={icon}>{t(`projects.visibility.icon.${icon}`)}</option>)}
    </select></FormField></div>
    {conflict ? <ActionNote tone="neutral">{t('projects.visibility.presentationConflict', { revision: saved.revision })} {saved.description} · {t(`projects.visibility.icon.${saved.icon}`)}</ActionNote> : null}
    {conflict ? <Button disabled={save.isPending} onClick={() => { setBase({ ...base, revision: saved.revision }); save.reset(); }}>{t('projects.visibility.keepDraft')}</Button> : null}
    <div className={styles.actions}><Button type="submit" variant="primary" disabled={save.isPending}>{t(save.isPending ? 'projects.visibility.saving' : 'projects.visibility.savePresentation')}</Button><Button disabled={save.isPending} onClick={() => { setDraft(saved); setBase(saved); setInvalid(false); save.reset(); }}>{t('projects.visibility.cancel')}</Button></div>
    {save.isError ? <ActionNote tone="error">{errorMessage(save.error)}</ActionNote> : null}
    {save.isSuccess && !dirty ? <ActionNote tone="success">{t('projects.visibility.saved')}</ActionNote> : null}
  </form>;
}
