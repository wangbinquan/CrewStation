import type { MemberCandidateDto } from '@crewstation/contracts';
import { useId } from 'react';
import { api } from '../../../../shared/api/client';
import { queryKeys } from '../../../../shared/api/queryKeys';
import { useApiQuery } from '../../../../shared/api/useApi';
import { useT } from '../../../../shared/lib/useT';
import { Button } from '../../../../shared/ui/Button';
import { FormField } from '../../../../shared/ui/FormField';
import { QueryStatus } from '../../../../shared/ui/QueryStatus';
import { Segmented } from '../../../../shared/ui/Segmented';
import type { MemberTargetMode } from '../../model/useMemberEditor';
import { MemberLookup } from '../../../../shared/project/MemberLookup';
import { PersonCard } from '../../../../shared/project/PersonCard';
import styles from '../MemberForm.module.css';

interface PickerProps {
  readonly isAdmin: boolean;
  readonly disabled: boolean;
  readonly user: MemberCandidateDto | undefined;
  readonly rawId: string;
  readonly mode: MemberTargetMode;
  readonly identity: string;
  readonly error: string | undefined;
  readonly onSelect: (user: MemberCandidateDto | undefined) => void;
  readonly onRawId: (value: string) => void;
  readonly onMode: (value: MemberTargetMode) => void;
  readonly onIdentity: (value: string) => void;
  readonly projectId: string;
}

/** 选人：三种方式在一行里切换（`Segmented`）；选中后只剩这个人的卡片与「更换成员」。 */
export function MemberTargetPicker(props: PickerProps) {
  const { user, rawId, disabled, error, onSelect, onRawId, isAdmin, projectId, identity, onMode, onIdentity } = props;
  const t = useT(), id = useId(), mode = props.mode === 'directory' && !isAdmin ? 'lookup' : props.mode;
  if (user) return <div className={styles.selected}>
    <span className={styles.caption}>{t('projects.members.selectedLabel')}</span>
    <PersonCard name={user.name} email={user.email} action={<Button disabled={disabled} onClick={() => onSelect(undefined)}>{t('projects.members.changeTarget')}</Button>} />
  </div>;
  const modes: readonly MemberTargetMode[] = isAdmin ? ['lookup', 'id', 'directory'] : ['lookup', 'id'];
  return <div className={styles.picker}>
    <Segmented label={t('projects.members.modeLabel')} value={mode} items={modes.map((value) => ({ value, label: t(`projects.members.mode.${value}`), disabled }))}
      onChange={(value) => { const next = modes.find((item) => item === value); if (next) onMode(next); }} />
    <div hidden={mode !== 'lookup'}><MemberLookup projectId={projectId} inputState={{ value: identity, onChange: onIdentity }} onSelect={onSelect} actionKey="projects.members.select" disabled={disabled || mode !== 'lookup'} selectionError={error} /></div>
    {mode === 'id' ? <FormField label={t('projects.members.rawId')} hint={t('projects.members.userIdHint')} error={error} hintId={`${id}-hint`} errorId={`${id}-error`}>
      <input value={rawId} disabled={disabled} aria-invalid={Boolean(error)} aria-describedby={`${id}-hint${error ? ` ${id}-error` : ''}`} onChange={(event) => onRawId(event.target.value)} />
    </FormField> : null}
    {mode === 'directory' ? <AdminMemberDirectory disabled={disabled} onSelect={onSelect} error={error} /> : null}
  </div>;
}

function AdminMemberDirectory({ disabled, onSelect, error }: Pick<PickerProps, 'disabled' | 'onSelect' | 'error'>) {
  const t = useT(), id = useId(), users = useApiQuery(queryKeys.users(), () => api.users.list());
  return <>
    <QueryStatus isPending={users.isPending} error={users.error} loadingKey="projects.create.usersLoading" errorKey="projects.create.usersError" />
    <FormField label={t('projects.members.user')} hint={t('projects.members.directoryHint')} error={error} hintId={`${id}-hint`} errorId={`${id}-error`}>
      <select value="" aria-invalid={Boolean(error)} aria-describedby={`${id}-hint${error ? ` ${id}-error` : ''}`} disabled={disabled || users.isPending || users.isError} onChange={(event) => {
        const user = users.data?.items.find((item) => item.id === event.target.value);
        if (user) onSelect({ userId: user.id, name: user.name, email: user.email, platformRole: user.platformRole });
      }}><option value="">{t('projects.members.userPlaceholder')}</option>{users.data?.items.map((user) => <option value={user.id} key={user.id}>{user.name} · {user.email}</option>)}</select>
    </FormField>
  </>;
}
