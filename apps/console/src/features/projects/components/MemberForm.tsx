import type { MemberRole } from '@crewstation/contracts';
import { useEffect, useId, useRef } from 'react';
import { useT } from '../../../shared/lib/useT';
import { UnsavedChangesGuard } from '../../../shared/navigation/UnsavedChangesGuard';
import { ActionNote } from '../../../shared/ui/ActionNote';
import { FormField } from '../../../shared/ui/FormField';
import { ConfirmationDialog } from '../../../shared/ui/dialog/ConfirmationDialog';
import { FormDialog } from '../../../shared/ui/dialog/FormDialog';
import { useMemberEditor } from '../model/useMemberEditor';
import type { MemberEditorOptions } from '../model/useMemberEditor';
import { MemberTargetPicker } from './members/MemberTargetPicker';
import styles from './MemberForm.module.css';

interface MemberFormProps extends MemberEditorOptions {
  /** 弹窗开着；关着时组件仍挂载，草稿与离开确认都在（2026-09-23 裁定）。 */
  readonly open: boolean;
  readonly onDirtyChange: (dirty: boolean) => void;
  /** ✕、取消、Esc：只关窗。 */
  readonly onClose: () => void;
  /** 清空：同一个对象重新起一份表单。 */
  readonly onClear: () => void;
}

/**
 * 添加成员或修改角色的弹窗：查找只选择目标，赋角色仍调用既有 PUT；高级 ID 与管理员目录保留。
 * 一栏，先选人、分隔线下再选角色（2026-09-23 重排）；提交键按结果命名：目标已是成员时「保存角色」，否则「添加成员」。
 * 转为负责人要再确认一次（叠在表单弹窗上的确认弹窗）。
 */
export function MemberForm(props: MemberFormProps) {
  const { projectId, isAdmin, pending, disabled, canManage, onDirtyChange, open, initialMember } = props;
  const t = useT(), id = useId(), editor = useMemberEditor(props), fields = useRef<HTMLDivElement>(null);
  const { user, rawId, mode, identity, error, locked, role, confirmedInput, targetId, current, currentOwner } = editor;
  useEffect(() => { onDirtyChange(editor.dirty || pending); return () => onDirtyChange(false); }, [editor.dirty, pending, onDirtyChange]);
  if (!canManage && !editor.dirty && !pending) return null;
  const blocked = disabled || !canManage || pending || (current?.role === 'owner' && (!isAdmin || role !== 'owner'));
  return <>
    <UnsavedChangesGuard dirty={editor.dirty || pending} scope={t('projects.members.title')} />
    {open ? <FormDialog title={initialMember ? t('projects.members.editTitle', { name: initialMember.name }) : t('projects.members.add')} submitLabel={t(current ? 'projects.members.saveRole' : 'projects.members.add')} busyLabel={t('projects.members.saving')}
      busy={pending} submitDisabled={blocked || Boolean(confirmedInput)} dirty={editor.dirty} onClear={props.onClear} onClose={props.onClose} onSubmit={() => editor.submit(fields.current)}>
      <div ref={fields} className={styles.form}>
        <MemberTargetPicker key={editor.pickerKey} projectId={projectId} isAdmin={isAdmin} user={user} rawId={rawId} mode={mode} identity={identity} error={error} disabled={locked} onSelect={editor.select} onRawId={editor.changeRawId} onMode={editor.changeMode} onIdentity={editor.changeIdentity} />
        <div className={styles.role}>
          <FormField label={t('projects.members.columnRole')} hint={t(`projects.members.roleHint.${role}`)} hintId={`${id}-role-hint`}>
            <select aria-label={t('projects.members.roleLabel')} aria-describedby={`${id}-role-hint ${id}-owner-rule`} value={role} disabled={locked || (current?.role === 'owner' && !isAdmin)} onChange={(event) => editor.setRole(event.target.value as MemberRole)}>
              {(['owner', 'developer', 'tester', 'user'] as const).map((value) => <option value={value} key={value} disabled={value === 'owner' && !isAdmin || (value === 'owner' || value === 'developer') && user?.platformRole === 'user'}>{t(`projects.role.${value}`)}</option>)}
            </select>
          </FormField>
          {current ? <ActionNote tone="neutral">{t('projects.members.changeRole', { name: current.name, from: t(`projects.role.${current.role}`), to: t(`projects.role.${role}`) })}</ActionNote> : null}
          {current?.role === 'owner' && role !== 'owner' ? <ActionNote tone="error">{t('projects.members.cannotDemote')}</ActionNote> : null}
          <p id={`${id}-owner-rule`} className={styles.rule}>{t('projects.members.ownerRule')}</p>
        </div>
      </div>
    </FormDialog> : null}
    {open && confirmedInput ? <ConfirmationDialog question={t('projects.members.transferQuestion', { from: currentOwner?.name ?? '—', to: user?.name ?? targetId })} hint={t('projects.members.transferEffect')}
      confirmLabel={t('projects.members.confirmTransfer')} busy={pending} confirmDisabled={disabled || !canManage || !isAdmin} onConfirm={() => { void editor.save(confirmedInput); }} onCancel={editor.cancelTransfer}>
      {!isAdmin ? <p role="status">{t('projects.members.transferUnavailable')}</p> : null}
    </ConfirmationDialog> : null}
  </>;
}
