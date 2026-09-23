import type { MemberCandidateDto } from '@crewstation/contracts';
import { useId, useState } from 'react';
import { api } from '../api/client';
import { errorMessage, useApiMutation } from '../api/useApi';
import { useT } from '../lib/useT';
import { ActionNote } from '../ui/ActionNote';
import { Button } from '../ui/Button';
import { FormField } from '../ui/FormField';
import styles from './MemberLookup.module.css';
import { PersonCard } from './PersonCard';

interface MemberLookupProps {
  readonly projectId: string;
  readonly onSelect: (user: MemberCandidateDto) => void;
  readonly actionKey?: string;
  readonly disabled?: boolean;
  readonly selectionError?: string;
  readonly inputState?: { readonly value: string; readonly onChange: (value: string) => void };
}

/** 精确查询，不请求全局用户目录。查询失败保留输入，变更输入使旧候选立即失效。可见范围、成员与正式版本维护（RFC-021）共用。 */
export function MemberLookup({ projectId, onSelect, actionKey = 'projects.visibility.addUser', disabled = false, selectionError, inputState }: MemberLookupProps) {
  const t = useT(), id = useId(), [localIdentity, setIdentity] = useState(''), [error, setError] = useState<string>();
  const identity = inputState?.value ?? localIdentity;
  const lookup = useApiMutation((value: string) => api.projects.memberCandidates(projectId, value));
  const search = () => {
    if (disabled || lookup.isPending) return;
    if (!identity.trim() || identity.trim().length > 254) { setError(t('projects.visibility.identityRequired')); return; }
    setError(undefined); lookup.mutate(identity.trim());
  };
  const fieldError = error ?? selectionError;
  return <div className={styles.stack}>
    <div className={styles.search}>
      <FormField label={t('projects.visibility.identity')} hint={t('projects.visibility.identityHint')} hintId={`${id}-hint`} error={fieldError} errorId={`${id}-error`}>
        <input value={identity} disabled={disabled || lookup.isPending} aria-invalid={Boolean(fieldError)} aria-describedby={`${id}-hint${fieldError ? ` ${id}-error` : ''}`} onChange={(event) => { setIdentity(event.target.value); inputState?.onChange(event.target.value); lookup.reset(); setError(undefined); }} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); search(); } }} />
      </FormField>
      <Button disabled={disabled || lookup.isPending} onClick={search}>{t('projects.visibility.findUser')}</Button>
    </div>
    {lookup.isError ? <ActionNote tone="error">{errorMessage(lookup.error)}</ActionNote> : null}
    {lookup.data?.items.map((user) => <PersonCard key={user.userId} name={user.name} email={user.email} action={<Button disabled={disabled} onClick={() => onSelect(user)}>{t(actionKey)}</Button>} />)}
    {lookup.isSuccess && lookup.data.items.length === 0 ? <ActionNote tone="neutral">{t('projects.visibility.noUser')}</ActionNote> : null}
  </div>;
}
