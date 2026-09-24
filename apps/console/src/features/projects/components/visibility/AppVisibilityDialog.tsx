import type { AppVisibilityDto } from '@crewstation/contracts';
import { useId } from 'react';
import type { ReactElement } from 'react';
import { errorMessage } from '../../../../shared/api/useApi';
import { useT } from '../../../../shared/lib/useT';
import { ActionNote } from '../../../../shared/ui/ActionNote';
import { Button } from '../../../../shared/ui/Button';
import { FormField } from '../../../../shared/ui/FormField';
import { FormDialog } from '../../../../shared/ui/dialog/FormDialog';
import type { useVisibilityEditor } from '../../model/useVisibilityEditor';
import styles from './Visibility.module.css';

const MODES = ['members', 'authenticated'] as const;
const requestsOf = (allow: boolean) => (allow ? 'open' : 'closed');

/** 卡片上的可见范围与申请开关：只显示服务器上已保存的一版；草稿在弹窗里，关窗也不丢。 */
export function AppVisibilitySummary({ saved, canConfigure }: { readonly saved: AppVisibilityDto; readonly canConfigure: boolean }): ReactElement {
  const t = useT(), requests = requestsOf(saved.allowRequests);
  return <div className={styles.stack}>
    <strong>{t(`projects.visibility.mode.${saved.mode}`)}</strong><span>{t('projects.visibility.savedRevision', { revision: saved.revision })}</span>
    <p>{t(`projects.visibility.hint.${saved.mode}`)}</p>
    <p>{t('projects.visibility.requestsSummary', { value: t(`projects.visibility.requests.${requests}`) })}</p>
    <p>{t(`projects.visibility.requestsHint.${requests}`)}</p>
    {!canConfigure ? <ActionNote tone="neutral">{t('projects.visibility.readOnly')}</ActionNote> : null}
  </div>;
}

interface VisibilityDialogProps {
  readonly saved: AppVisibilityDto;
  readonly editor: ReturnType<typeof useVisibilityEditor>;
  readonly onClose: () => void;
}

/**
 * 修改可见范围的弹窗（2026-09-23 起由卡片里的行内表单改为弹窗）。2026-09-24 起两档范围，
 * 同时决定市场可见与网关放行正式地址，外加「允许申请／只能授权」。
 */
export function AppVisibilityDialog({ saved, editor, onClose }: VisibilityDialogProps): ReactElement {
  const t = useT(), id = useId(), locked = editor.save.isPending, requests = requestsOf(editor.draft.allowRequests);
  return <FormDialog title={t('projects.visibility.editScope')} submitLabel={t('projects.visibility.save')} busyLabel={t('projects.visibility.saving')} busy={editor.save.isPending}
    submitDisabled={!editor.canSubmit} error={editor.save.isError ? errorMessage(editor.save.error) : undefined} dirty={editor.dirty} onClear={editor.cancel} onClose={onClose} onSubmit={editor.submit}>
    <div className={styles.stack}>
      <FormField label={t('projects.visibility.scope')} hint={t(`projects.visibility.hint.${editor.draft.mode}`)} hintId={`${id}-hint`}>
        <select value={editor.draft.mode} aria-describedby={`${id}-hint`} disabled={locked} onChange={(event) => editor.select(event.target.value as AppVisibilityDto['mode'])}>
          {MODES.map((mode) => <option key={mode} value={mode}>{t(`projects.visibility.mode.${mode}`)}</option>)}
        </select>
      </FormField>
      <FormField label={t('projects.visibility.requests')} hint={t(`projects.visibility.requestsHint.${requests}`)} hintId={`${id}-requests`}>
        <select value={requests} aria-describedby={`${id}-requests`} disabled={locked} onChange={(event) => editor.allowRequests(event.target.value === 'open')}>
          {(['open', 'closed'] as const).map((value) => <option key={value} value={value}>{t(`projects.visibility.requests.${value}`)}</option>)}
        </select>
      </FormField>
      <p>{t('projects.visibility.boundary')}</p>
      {editor.conflict ? <ActionNote tone="neutral">{t('projects.visibility.conflict', { revision: saved.revision, mode: t(`projects.visibility.mode.${saved.mode}`), requests: t(`projects.visibility.requests.${requestsOf(saved.allowRequests)}`) })}</ActionNote> : null}
      {editor.conflict ? <Button disabled={!editor.canRebase} onClick={editor.rebaseDraft}>{t('projects.visibility.keepDraft')}</Button> : null}
      <p className={styles.status}>{t(editor.dirty ? 'projects.visibility.unsaved' : 'projects.visibility.savedRevision', { revision: saved.revision })}</p>
    </div>
  </FormDialog>;
}
