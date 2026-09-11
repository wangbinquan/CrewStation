import type { MemberRole, SetMemberRequest, UserId } from '@crewstation/contracts';
import type { FormEvent, ReactElement } from 'react';
import { useState } from 'react';
import { api } from '../../../shared/api/client';
import { queryKeys } from '../../../shared/api/queryKeys';
import { errorMessage, useApiMutation, useApiQuery } from '../../../shared/api/useApi';
import { useT } from '../../../shared/lib/useT';
import { Button } from '../../../shared/ui/Button';
import { ActionNote } from './ActionNote';
import { FormField } from './FormField';
import styles from './MemberForm.module.css';

const ROLES: readonly MemberRole[] = ['owner', 'developer', 'tester'];

export interface MemberFormProps {
  readonly projectId: string;
  /** 用户目录只对管理员开放；非管理员的负责人退化为手填用户 ID。 */
  readonly isAdmin: boolean;
}

/** 新增成员或改角色都是同一个 PUT：按 userId 覆盖。 */
export function MemberForm({ projectId, isAdmin }: MemberFormProps): ReactElement {
  const t = useT();
  const [userId, setUserId] = useState('');
  const [role, setRole] = useState<MemberRole>('developer');
  const users = useApiQuery(queryKeys.users(), () => api.users.list(), { enabled: isAdmin });
  const save = useApiMutation((input: SetMemberRequest) => api.projects.setMember(projectId, input), {
    invalidate: [queryKeys.members(projectId)],
    onSuccess: () => setUserId(''),
  });
  const directory = users.data?.items;

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const trimmed = userId.trim();
    if (trimmed.length === 0) return;
    // 目录可用时取原记录的品牌化 id，手填时只能断言；格式错了服务端会 400。
    save.mutate({ userId: directory?.find((user) => user.id === trimmed)?.id ?? (trimmed as UserId), role });
  }

  return (
    <>
      <form className={styles.form} onSubmit={submit}>
        <FormField label={t('projects.members.user')} hint={directory === undefined ? t('projects.members.userIdHint') : undefined}>
          {directory === undefined ? (
            <input value={userId} required onChange={(event) => setUserId(event.target.value)} />
          ) : (
            <select value={userId} required onChange={(event) => setUserId(event.target.value)}>
              <option value="">{t('projects.members.userPlaceholder')}</option>
              {directory.map((user) => (
                <option key={user.id} value={user.id}>{`${user.name}（${user.email}）`}</option>
              ))}
            </select>
          )}
        </FormField>
        <FormField label={t('projects.members.columnRole')}>
          <select value={role} onChange={(event) => setRole(event.target.value as MemberRole)}>
            {ROLES.map((value) => (
              <option key={value} value={value}>
                {t(`projects.role.${value}`)}
              </option>
            ))}
          </select>
        </FormField>
        <Button type="submit" variant="primary" disabled={save.isPending}>
          {save.isPending ? t('projects.members.saving') : t('projects.members.submit')}
        </Button>
      </form>
      {save.isError ? <ActionNote tone="error">{t('projects.members.saveError', { message: errorMessage(save.error) })}</ActionNote> : null}
    </>
  );
}
