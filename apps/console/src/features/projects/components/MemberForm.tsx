import { UserIdSchema } from '@crewstation/contracts';
import type { MemberCandidateDto, MemberDto, MemberRole, SetMemberRequest } from '@crewstation/contracts';
import type { FormEvent } from 'react';
import { useId, useRef, useState } from 'react';
import { useT } from '../../../shared/lib/useT';
import { Button } from '../../../shared/ui/Button';
import { ConfirmationPanel } from '../../../shared/ui/ConfirmationPanel';
import { FormField } from '../../../shared/ui/FormField';
import { MemberTargetPicker } from './members/MemberTargetPicker';
import styles from './MemberForm.module.css';

export interface MemberFormProps {
  readonly projectId: string;
  readonly isAdmin: boolean;
  readonly members: readonly MemberDto[];
  readonly pending: boolean;
  readonly disabled: boolean;
  readonly onSave: (input: SetMemberRequest) => Promise<MemberDto | undefined>;
}

/** 查找只选择目标；赋角色仍调用既有 PUT。高级 ID 与管理员目录保留。 */
export function MemberForm({ projectId, isAdmin, members, pending, disabled, onSave }: MemberFormProps) {
  const t = useT(), id = useId(), form = useRef<HTMLFormElement>(null);
  const [user, setUser] = useState<MemberCandidateDto>(), [rawId, setRawId] = useState('');
  const [role, setRole] = useState<MemberRole>('developer'), [error, setError] = useState<string>(), [confirmedInput, setConfirmedInput] = useState<SetMemberRequest>();
  const [pickerKey, setPickerKey] = useState(0);
  const targetId = user?.userId ?? rawId.trim(), current = members.find((member) => member.userId === targetId);
  const currentOwner = members.find((member) => member.role === 'owner');
  const locked = disabled || pending || Boolean(confirmedInput);
  const save = async (input: SetMemberRequest) => {
    try { if (await onSave(input)) { setUser(undefined); setRawId(''); setRole('developer'); setPickerKey((value) => value + 1); setConfirmedInput(undefined); } }
    catch { /* 失败保留目标、角色与确认内容，父级展示真实错误。 */ }
  };
  const select = (value: MemberCandidateDto | undefined) => {
    setUser(value); setRawId(''); setError(undefined);
    setRole(members.find((member) => member.userId === value?.userId)?.role ?? 'developer');
  };
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (locked) return;
    const parsed = UserIdSchema.safeParse(targetId);
    if (!parsed.success) { setError(t('projects.members.targetRequired')); form.current?.querySelector<HTMLElement>('input, select')?.focus(); return; }
    if ((role === 'owner' && !isAdmin) || (current?.role === 'owner' && role !== 'owner')) return;
    setError(undefined); const input = { userId: parsed.data, role };
    if (role === 'owner' && current?.role !== 'owner') setConfirmedInput(input);
    else void save(input);
  }
  return <form ref={form} className={styles.form} onSubmit={submit} noValidate>
    <MemberTargetPicker key={pickerKey} projectId={projectId} isAdmin={isAdmin} user={user} rawId={rawId} error={error} disabled={locked} onSelect={select} onRawId={(value) => { setRawId(value); setError(undefined); }} />
    <FormField label={t('projects.members.columnRole')} hint={t(`projects.members.roleHint.${role}`)} hintId={`${id}-role-hint`}>
      <select aria-label={t('projects.members.roleLabel')} aria-describedby={`${id}-role-hint`} value={role} disabled={locked || (current?.role === 'owner' && !isAdmin)} onChange={(event) => setRole(event.target.value as MemberRole)}>
        {(['owner', 'developer', 'tester'] as const).map((value) => <option value={value} key={value} disabled={value === 'owner' && !isAdmin}>{t(`projects.role.${value}`)}</option>)}
      </select>
    </FormField>
    <p>{t('projects.members.ownerRule')}</p>
    {current ? <p>{t('projects.members.changeRole', { name: current.name, from: t(`projects.role.${current.role}`), to: t(`projects.role.${role}`) })}</p> : null}
    {current?.role === 'owner' && role !== 'owner' ? <p role="alert">{t('projects.members.cannotDemote')}</p> : null}
    {confirmedInput ? <ConfirmationPanel question={t('projects.members.transferQuestion', { from: currentOwner?.name ?? '—', to: user?.name ?? targetId })} hint={t('projects.members.transferEffect')} confirmLabel={t('projects.members.confirmTransfer')} cancelLabel={t('ui.confirm.no')} busy={pending} confirmDisabled={disabled} onConfirm={() => { void save(confirmedInput); }} onCancel={() => setConfirmedInput(undefined)} /> : <div className={styles.actions}>
      <Button type="submit" variant="primary" disabled={disabled || pending || (current?.role === 'owner' && (!isAdmin || role !== 'owner'))}>{t(pending ? 'projects.members.saving' : 'projects.members.submit')}</Button>
    </div>}
  </form>;
}
