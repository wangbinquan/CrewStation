import type { AppVisibilityDto } from '@crewstation/contracts';
import { useId, useRef } from 'react';
import type { ReactElement } from 'react';
import { errorMessage } from '../../../../shared/api/useApi';
import { useT } from '../../../../shared/lib/useT';
import { ActionNote } from '../../../../shared/ui/ActionNote';
import { Button } from '../../../../shared/ui/Button';
import { FormField } from '../../../../shared/ui/FormField';
import { FormDialog } from '../../../../shared/ui/dialog/FormDialog';
import type { useVisibilityEditor } from '../../model/useVisibilityEditor';
import { MemberLookup } from '../../../../shared/project/MemberLookup';
import styles from './Visibility.module.css';

const MODES = ['members', 'authenticated', 'selected'] as const;

/** 卡片上的可见范围：只显示服务器上已保存的一版；草稿在弹窗里，关窗也不丢。 */
export function AppVisibilitySummary({ saved, canConfigure }: { readonly saved: AppVisibilityDto; readonly canConfigure: boolean }): ReactElement {
  const t = useT();
  return <div className={styles.stack}><strong>{t(`projects.visibility.mode.${saved.mode}`)}</strong><span>{t('projects.visibility.savedRevision', { revision: saved.revision })}</span><p>{t(`projects.visibility.hint.${saved.mode}`)}</p><p>{saved.users.map((user) => `${user.name} · ${user.email}`).join('；')}</p>{!canConfigure ? <ActionNote tone="neutral">{t('projects.visibility.readOnly')}</ActionNote> : null}</div>;
}

interface VisibilityDialogProps {
  readonly projectId: string;
  readonly saved: AppVisibilityDto;
  readonly editor: ReturnType<typeof useVisibilityEditor>;
  readonly onClose: () => void;
}

/** 修改市场可见范围的弹窗（2026-09-23 起由卡片里的行内表单改为弹窗）：三种范围，指定用户时精确查找账号加入。 */
export function AppVisibilityDialog({ projectId, saved, editor, onClose }: VisibilityDialogProps): ReactElement {
  const t = useT(), id = useId(), fields = useRef<HTMLDivElement>(null), locked = editor.save.isPending;
  return <FormDialog title={t('projects.visibility.editScope')} submitLabel={t('projects.visibility.save')} busyLabel={t('projects.visibility.saving')} busy={editor.save.isPending}
    submitDisabled={!editor.canSubmit} error={editor.save.isError ? errorMessage(editor.save.error) : undefined} dirty={editor.dirty} onClear={editor.cancel} onClose={onClose} onSubmit={() => { if (fields.current) editor.submit(fields.current); }}>
    <div ref={fields} className={styles.stack}>
      <FormField label={t('projects.visibility.scope')} hint={t(`projects.visibility.hint.${editor.draft.mode}`)} hintId={`${id}-hint`}>
        <select value={editor.draft.mode} aria-describedby={`${id}-hint`} disabled={locked} onChange={(event) => editor.select(event.target.value as AppVisibilityDto['mode'])}>
          {MODES.map((mode) => <option key={mode} value={mode}>{t(`projects.visibility.mode.${mode}`)}</option>)}
        </select>
      </FormField>
      <div hidden={editor.draft.mode !== 'selected'}><div className={styles.stack} role="group" aria-label={t('projects.visibility.users')} aria-describedby={`${id}-usersHint${editor.invalid ? ` ${id}-error` : ''}`}>
        <p id={`${id}-usersHint`}>{t('projects.visibility.usersHint')}</p>
        <MemberLookup projectId={projectId} disabled={locked || editor.draft.mode !== 'selected' || editor.draft.userIds.length >= 200} onSelect={editor.add} />
        <ul className={styles.people}>{editor.draft.userIds.map((userId) => {
          const user = editor.draft.users.find((item) => item.userId === userId);
          return <li className={styles.person} key={userId}><span>{user ? `${user.name} · ${user.email}` : userId}</span><Button size="small" disabled={locked} aria-label={`${t('projects.visibility.remove')} ${user?.name ?? userId}`} onClick={() => editor.remove(userId)}>{t('projects.visibility.remove')}</Button></li>;
        })}</ul>
        {editor.invalid ? <ActionNote tone="error"><span id={`${id}-error`}>{t('projects.visibility.atLeastOne')}</span></ActionNote> : null}
      </div></div>
      <p>{t('projects.visibility.boundary')}</p>
      {editor.conflict ? <ActionNote tone="neutral">{t('projects.visibility.conflict', { revision: saved.revision, mode: t(`projects.visibility.mode.${saved.mode}`) })} {saved.users.map((user) => `${user.name} · ${user.email}`).join('；')}</ActionNote> : null}
      {editor.conflict ? <Button disabled={!editor.canRebase} onClick={editor.rebaseDraft}>{t('projects.visibility.keepDraft')}</Button> : null}
      <p className={styles.status}>{t(editor.dirty ? 'projects.visibility.unsaved' : 'projects.visibility.savedRevision', { revision: saved.revision })}</p>
    </div>
  </FormDialog>;
}
