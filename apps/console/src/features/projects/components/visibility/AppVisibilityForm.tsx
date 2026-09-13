import type { AppVisibilityDto } from '@crewstation/contracts';
import { useId } from 'react';
import { errorMessage } from '../../../../shared/api/useApi';
import { useT } from '../../../../shared/lib/useT';
import { ActionNote } from '../../../../shared/ui/ActionNote';
import { Button } from '../../../../shared/ui/Button';
import { FormField } from '../../../../shared/ui/FormField';
import type { useVisibilityEditor } from '../../model/useVisibilityEditor';
import { MemberLookup } from './MemberLookup';
import styles from './Visibility.module.css';

const MODES = ['members', 'authenticated', 'selected'] as const;
interface VisibilityFormProps {
  readonly projectId: string;
  readonly saved: AppVisibilityDto;
  readonly editor: ReturnType<typeof useVisibilityEditor>;
  readonly canConfigure: boolean;
  readonly frozen: boolean;
  readonly cancelDisabled: boolean;
  readonly onCancel: (button: HTMLButtonElement) => void;
}

export function AppVisibilityForm({ projectId, saved, editor, canConfigure, frozen, cancelDisabled, onCancel }: VisibilityFormProps) {
  const t = useT(), id = useId(), locked = editor.save.isPending || frozen || !canConfigure;
  if (!canConfigure && !editor.dirty && !editor.save.isPending) return <div className={styles.stack}><strong>{t(`projects.visibility.mode.${saved.mode}`)}</strong><p>{t(`projects.visibility.hint.${saved.mode}`)}</p><p>{saved.users.map((user) => `${user.name} · ${user.email}`).join('；')}</p><ActionNote tone="neutral">{t('projects.visibility.readOnly')}</ActionNote></div>;
  return <form className={styles.stack} onSubmit={(event) => { event.preventDefault(); editor.submit(event.currentTarget); }} noValidate>
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
        return <li className={styles.person} key={userId}><span>{user ? `${user.name} · ${user.email}` : userId}</span><Button disabled={locked} aria-label={`${t('projects.visibility.remove')} ${user?.name ?? userId}`} onClick={() => editor.remove(userId)}>{t('projects.visibility.remove')}</Button></li>;
      })}</ul>
      {editor.invalid ? <ActionNote tone="error"><span id={`${id}-error`}>{t('projects.visibility.atLeastOne')}</span></ActionNote> : null}
    </div></div>
    <p>{t('projects.visibility.boundary')}</p>
    {editor.conflict ? <ActionNote tone="neutral">{t('projects.visibility.conflict', { revision: saved.revision, mode: t(`projects.visibility.mode.${saved.mode}`) })} {saved.users.map((user) => `${user.name} · ${user.email}`).join('；')}</ActionNote> : null}
    {editor.conflict ? <Button disabled={!editor.canRebase} onClick={editor.rebaseDraft}>{t('projects.visibility.keepDraft')}</Button> : null}
    <div className={styles.actions}>
      <Button type="submit" variant="primary" disabled={!editor.canSubmit}>{t(editor.save.isPending ? 'projects.visibility.saving' : 'projects.visibility.save')}</Button>
      <Button disabled={cancelDisabled || frozen} onClick={(event) => onCancel(event.currentTarget)}>{t('projects.visibility.cancel')}</Button>
      <span>{t(editor.dirty ? 'projects.visibility.unsaved' : 'projects.visibility.savedRevision', { revision: saved.revision })}</span>
    </div>
    {editor.save.isError ? <ActionNote tone="error">{errorMessage(editor.save.error)}</ActionNote> : null}
    {editor.save.isSuccess && !editor.dirty ? <ActionNote tone="success">{t('projects.visibility.saved')}</ActionNote> : null}
  </form>;
}
