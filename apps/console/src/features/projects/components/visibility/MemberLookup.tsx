import type { MemberCandidateDto } from '@crewstation/contracts';
import { useId, useState } from 'react';
import { api } from '../../../../shared/api/client';
import { errorMessage, useApiMutation } from '../../../../shared/api/useApi';
import { useT } from '../../../../shared/lib/useT';
import { ActionNote } from '../../../../shared/ui/ActionNote';
import { Button } from '../../../../shared/ui/Button';
import { FormField } from '../../../../shared/ui/FormField';
import styles from './Visibility.module.css';

/** 精确查询，不请求全局用户目录。查询失败保留输入，变更输入使旧候选立即失效。 */
export function MemberLookup({ projectId, onSelect, actionKey = 'projects.visibility.addUser', disabled = false }: { readonly projectId: string; readonly onSelect: (user: MemberCandidateDto) => void; readonly actionKey?: string; readonly disabled?: boolean }) {
  const t = useT(), id = useId(), [identity, setIdentity] = useState(''), [error, setError] = useState<string>();
  const lookup = useApiMutation((value: string) => api.projects.memberCandidates(projectId, value));
  const search = () => {
    if (!identity.trim() || identity.trim().length > 254) { setError(t('projects.visibility.identityRequired')); return; }
    setError(undefined); lookup.mutate(identity.trim());
  };
  return <div className={styles.stack}>
    <div className={styles.search}>
      <FormField label={t('projects.visibility.identity')} hint={t('projects.visibility.identityHint')} hintId={`${id}-hint`} error={error} errorId={`${id}-error`}>
        <input value={identity} disabled={disabled || lookup.isPending} aria-invalid={Boolean(error)} aria-describedby={`${id}-hint${error ? ` ${id}-error` : ''}`} onChange={(event) => { setIdentity(event.target.value); lookup.reset(); setError(undefined); }} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); search(); } }} />
      </FormField>
      <Button disabled={disabled || lookup.isPending} onClick={search}>{t('projects.visibility.findUser')}</Button>
    </div>
    {lookup.isError ? <ActionNote tone="error">{errorMessage(lookup.error)}</ActionNote> : null}
    {lookup.data?.items.map((user) => <div className={styles.person} key={user.userId}><span>{user.name} · {user.email}</span><Button disabled={disabled} onClick={() => onSelect(user)}>{t(actionKey)}</Button></div>)}
    {lookup.isSuccess && lookup.data.items.length === 0 ? <ActionNote tone="neutral">{t('projects.visibility.noUser')}</ActionNote> : null}
  </div>;
}
