import type { MemberRole } from '@crewstation/contracts';
import { useEffect, useId, useRef } from 'react';
import { useT } from '../../../shared/lib/useT';
import { UnsavedChangesGuard } from '../../../shared/navigation/UnsavedChangesGuard';
import { Button } from '../../../shared/ui/Button';
import { ConfirmationPanel } from '../../../shared/ui/ConfirmationPanel';
import { FormField } from '../../../shared/ui/FormField';
import { useMemberEditor } from '../model/useMemberEditor';
import type { MemberEditorOptions } from '../model/useMemberEditor';
import { MemberTargetPicker } from './members/MemberTargetPicker';
import styles from './MemberForm.module.css';

/** 查找只选择目标；赋角色仍调用既有 PUT。高级 ID 与管理员目录保留。 */
export function MemberForm(props: MemberEditorOptions & { readonly onDirtyChange: (dirty: boolean) => void; readonly onCancel: () => void }) {
  const { projectId, isAdmin, pending, disabled, canManage, onDirtyChange } = props;
  const t = useT(), id = useId(), editor = useMemberEditor(props);
  const { user, rawId, mode, identity, error, locked, role, confirmedInput, targetId, current, currentOwner } = editor;
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => { onDirtyChange(editor.dirty || pending); return () => onDirtyChange(false); }, [editor.dirty, pending, onDirtyChange]);
  useEffect(() => { form.current?.querySelector<HTMLElement>('input:not(:disabled), select:not(:disabled)')?.focus(); }, []);
  if (!canManage && !editor.dirty && !pending) return null;
  return <>
    <UnsavedChangesGuard dirty={editor.dirty || pending} scope={t('projects.members.title')} />
    <form ref={form} className={styles.form} onSubmit={editor.submit} noValidate>
    <MemberTargetPicker key={editor.pickerKey} projectId={projectId} isAdmin={isAdmin} user={user} rawId={rawId} mode={mode} identity={identity} error={error} disabled={locked} onSelect={editor.select} onRawId={editor.changeRawId} onMode={editor.changeMode} onIdentity={editor.changeIdentity} />
    <FormField label={t('projects.members.columnRole')} hint={t(`projects.members.roleHint.${role}`)} hintId={`${id}-role-hint`}>
      <select aria-label={t('projects.members.roleLabel')} aria-describedby={`${id}-role-hint`} value={role} disabled={locked || (current?.role === 'owner' && !isAdmin)} onChange={(event) => editor.setRole(event.target.value as MemberRole)}>
        {(['owner', 'developer', 'tester'] as const).map((value) => <option value={value} key={value} disabled={value === 'owner' && !isAdmin}>{t(`projects.role.${value}`)}</option>)}
      </select>
    </FormField>
    <p>{t('projects.members.ownerRule')}</p>
    {current ? <p>{t('projects.members.changeRole', { name: current.name, from: t(`projects.role.${current.role}`), to: t(`projects.role.${role}`) })}</p> : null}
    {current?.role === 'owner' && role !== 'owner' ? <p role="alert">{t('projects.members.cannotDemote')}</p> : null}
    {confirmedInput && !isAdmin ? <p role="status">{t('projects.members.transferUnavailable')}</p> : null}
    {confirmedInput ? <ConfirmationPanel question={t('projects.members.transferQuestion', { from: currentOwner?.name ?? '—', to: user?.name ?? targetId })} hint={t('projects.members.transferEffect')} confirmLabel={t('projects.members.confirmTransfer')} cancelLabel={t('ui.confirm.no')} busy={pending} confirmDisabled={disabled || !canManage || !isAdmin} onConfirm={() => { void editor.save(confirmedInput); }} onCancel={editor.cancelTransfer} /> : <div className={styles.actions}>
      <Button type="submit" variant="primary" disabled={disabled || !canManage || pending || (current?.role === 'owner' && (!isAdmin || role !== 'owner'))}>{t(pending ? 'projects.members.saving' : 'projects.members.submit')}</Button>
      <Button disabled={pending} onClick={props.onCancel}>{t('projects.members.cancel')}</Button>
    </div>}
  </form></>;
}
