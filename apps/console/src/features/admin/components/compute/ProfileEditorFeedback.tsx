import type { ReactElement } from 'react';
import { errorMessage } from '../../../../shared/api/useApi';
import { useT } from '../../../../shared/lib/useT';
import { ActionNote } from '../../../../shared/ui/ActionNote';
import { Badge } from '../../../../shared/ui/Badge';
import { Button } from '../../../../shared/ui/Button';
import type { ProfileDraftHandle } from '../../hooks/useProfileDraft';
import type { useProfileSave } from '../../hooks/useProfileSave';
import styles from './ComputeEditor.module.css';

interface FeedbackProps {
  readonly editor: ProfileDraftHandle;
  readonly saving: ReturnType<typeof useProfileSave>;
  readonly creating: boolean;
}

/** 保存入口固定在编辑区顶部，切换任何分组都能看见状态、提交与并发冲突。 */
export function ProfileEditorFeedback({ editor, saving, creating }: FeedbackProps): ReactElement {
  const t = useT(), errorCount = Object.keys(editor.errors).length;
  return <div className={styles.saveBar}>
    <div className={styles.saveActions}>
      <div className={styles.toolbar}>
        <span className={styles.toolbar}>
          {editor.dirty && !creating ? <Badge tone="warning">{t('admin.profile.dirty')}</Badge> : <span className={styles.hint}>{t(creating ? 'admin.profile.editor.createHint' : 'admin.profile.editor.upToDate')}</span>}
          {errorCount > 0 ? <Badge tone="danger">{t('admin.profile.errorCount', { count: errorCount })}</Badge> : null}
        </span>
        <span className={styles.hint}>{t('admin.profile.editor.saveHint')}</span>
      </div>
      <Button variant="primary" disabled={saving.busy || (!creating && !editor.dirty)} onClick={saving.submit}>{saving.save.isPending ? t('admin.profile.saving') : creating ? t('admin.profile.createSubmit') : t('admin.profile.save')}</Button>
    </div>
    {saving.note?.kind === 'revision' ? <ActionNote tone="success">{t('admin.profile.saved', { revision: saving.note.revision })}</ActionNote> : null}
    {saving.note?.kind === 'description' ? <ActionNote tone="success">{t('admin.profile.savedDescription')}</ActionNote> : null}
    {saving.conflict !== undefined ? (
      <ActionNote tone="error">
        {t('admin.profile.conflict', { revision: saving.conflict })}
        <span className={styles.toolbar}>
          <Button onClick={() => { editor.adoptRevision(saving.conflict!); saving.clearConflict(); }}>{t('admin.profile.adoptConflict', { revision: saving.conflict })}</Button>
          <Button onClick={() => saving.reload.mutate(undefined)}>{t('admin.profile.discard')}</Button>
        </span>
      </ActionNote>
    ) : saving.save.error ? <ActionNote tone="error">{t('admin.profile.saveError', { message: errorMessage(saving.save.error) })}</ActionNote> : null}
  </div>;
}
