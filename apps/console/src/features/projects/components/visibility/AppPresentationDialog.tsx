import type { AppIcon, AppPresentationDto } from '@crewstation/contracts';
import { useId, useRef } from 'react';
import type { ReactElement } from 'react';
import { errorMessage } from '../../../../shared/api/useApi';
import { useT } from '../../../../shared/lib/useT';
import { ActionNote } from '../../../../shared/ui/ActionNote';
import { Button } from '../../../../shared/ui/Button';
import { FormField } from '../../../../shared/ui/FormField';
import { GlyphIcon } from '../../../../shared/ui/icons/GlyphIcon';
import { FormDialog } from '../../../../shared/ui/dialog/FormDialog';
import type { usePresentationEditor } from '../../model/usePresentationEditor';
import styles from './Visibility.module.css';

/** 卡片上的展示资料：只显示服务器上已保存的一版；草稿在弹窗里，关窗也不丢。 */
export function AppPresentationSummary({ saved }: { readonly saved: AppPresentationDto }): ReactElement {
  const t = useT();
  return <div className={styles.person}><GlyphIcon name={saved.icon} /><p>{saved.description || t('projects.visibility.noDescription')}</p><span>{t('projects.visibility.savedRevision', { revision: saved.revision })}</span></div>;
}

interface PresentationDialogProps {
  readonly saved: AppPresentationDto;
  readonly editor: ReturnType<typeof usePresentationEditor>;
  readonly onClose: () => void;
}

/** 修改展示资料的弹窗（2026-09-23 起由卡片里的行内表单改为弹窗）：用途与图标；别人先保存过时说明冲突、可按新版本继续保存。 */
export function AppPresentationDialog({ saved, editor, onClose }: PresentationDialogProps): ReactElement {
  const t = useT(), id = useId(), fields = useRef<HTMLDivElement>(null), { draft, invalid, dirty, save, conflict } = editor;
  const locked = save.isPending;
  return <FormDialog title={t('projects.visibility.editPresentation')} submitLabel={t('projects.visibility.savePresentation')} busyLabel={t('projects.visibility.saving')} busy={save.isPending}
    submitDisabled={!editor.canSubmit} error={save.isError ? errorMessage(save.error) : undefined} dirty={dirty} onClear={editor.cancel} onClose={onClose} onSubmit={() => { if (fields.current) editor.submit(fields.current); }}>
    <div ref={fields} className={styles.stack}>
      <FormField label={t('projects.visibility.description')} hint={t('projects.visibility.descriptionHint')} hintId={`${id}-hint`} error={invalid ? t('projects.visibility.descriptionTooLong') : undefined} errorId={`${id}-error`}>
        <textarea rows={3} value={draft.description} disabled={locked} aria-invalid={invalid} aria-describedby={`${id}-hint${invalid ? ` ${id}-error` : ''}`} onChange={(event) => editor.describe(event.target.value)} />
      </FormField>
      <div className={styles.iconChoice}><GlyphIcon name={draft.icon} /><FormField label={t('projects.visibility.icon')}><select disabled={locked} value={draft.icon} onChange={(event) => editor.chooseIcon(event.target.value as AppIcon)}>
        {(['station', 'assistant', 'workflow', 'book', 'chart', 'spark'] as const).map((icon) => <option key={icon} value={icon}>{t(`projects.visibility.icon.${icon}`)}</option>)}
      </select></FormField></div>
      {conflict ? <ActionNote tone="neutral">{t('projects.visibility.presentationConflict', { revision: saved.revision })} {saved.description} · {t(`projects.visibility.icon.${saved.icon}`)}</ActionNote> : null}
      {conflict ? <Button disabled={!editor.canRebase} onClick={editor.rebaseDraft}>{t('projects.visibility.keepDraft')}</Button> : null}
      <p className={styles.status}>{t(dirty ? 'projects.visibility.unsaved' : 'projects.visibility.savedRevision', { revision: saved.revision })}</p>
    </div>
  </FormDialog>;
}
