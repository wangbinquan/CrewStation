import type { AppIcon, AppPresentationDto } from '@crewstation/contracts';
import { useId } from 'react';
import { errorMessage } from '../../../../shared/api/useApi';
import { useT } from '../../../../shared/lib/useT';
import { ActionNote } from '../../../../shared/ui/ActionNote';
import { Button } from '../../../../shared/ui/Button';
import { FormField } from '../../../../shared/ui/FormField';
import { GlyphIcon } from '../../../../shared/ui/icons/GlyphIcon';
import type { usePresentationEditor } from '../../model/usePresentationEditor';
import styles from './Visibility.module.css';

interface PresentationFormProps {
  readonly saved: AppPresentationDto;
  readonly editor: ReturnType<typeof usePresentationEditor>;
  readonly canConfigure: boolean;
  readonly frozen: boolean;
  readonly cancelDisabled: boolean;
  readonly onCancel: (button: HTMLButtonElement) => void;
}

export function AppPresentationForm({ saved, editor, canConfigure, frozen, cancelDisabled, onCancel }: PresentationFormProps) {
  const t = useT(), id = useId(), { draft, invalid, dirty, save, conflict } = editor;
  const locked = save.isPending || frozen || !canConfigure;
  if (!canConfigure && !dirty && !save.isPending) return <div className={styles.person}><GlyphIcon name={saved.icon} /><p>{saved.description || t('projects.visibility.noDescription')}</p></div>;
  return <form className={styles.stack} noValidate onSubmit={(event) => { event.preventDefault(); editor.submit(event.currentTarget); }}>
    <FormField label={t('projects.visibility.description')} hint={t('projects.visibility.descriptionHint')} hintId={`${id}-hint`} error={invalid ? t('projects.visibility.descriptionTooLong') : undefined} errorId={`${id}-error`}>
      <textarea rows={3} value={draft.description} disabled={locked} aria-invalid={invalid} aria-describedby={`${id}-hint${invalid ? ` ${id}-error` : ''}`} onChange={(event) => editor.describe(event.target.value)} />
    </FormField>
    <div className={styles.iconChoice}><GlyphIcon name={draft.icon} /><FormField label={t('projects.visibility.icon')}><select disabled={locked} value={draft.icon} onChange={(event) => editor.chooseIcon(event.target.value as AppIcon)}>
      {(['station', 'assistant', 'workflow', 'book', 'chart', 'spark'] as const).map((icon) => <option key={icon} value={icon}>{t(`projects.visibility.icon.${icon}`)}</option>)}
    </select></FormField></div>
    {conflict ? <ActionNote tone="neutral">{t('projects.visibility.presentationConflict', { revision: saved.revision })} {saved.description} · {t(`projects.visibility.icon.${saved.icon}`)}</ActionNote> : null}
    {conflict ? <Button disabled={!editor.canRebase} onClick={editor.rebaseDraft}>{t('projects.visibility.keepDraft')}</Button> : null}
    <div className={styles.actions}><Button type="submit" variant="primary" disabled={!editor.canSubmit}>{t(save.isPending ? 'projects.visibility.saving' : 'projects.visibility.savePresentation')}</Button><Button disabled={cancelDisabled || frozen} onClick={(event) => onCancel(event.currentTarget)}>{t('projects.visibility.cancel')}</Button><span>{t(dirty ? 'projects.visibility.unsaved' : 'projects.visibility.savedRevision', { revision: saved.revision })}</span></div>
    {save.isError ? <ActionNote tone="error">{errorMessage(save.error)}</ActionNote> : null}
    {save.isSuccess && !dirty ? <ActionNote tone="success">{t('projects.visibility.saved')}</ActionNote> : null}
  </form>;
}
