import { useState } from 'react';
import { api } from '../../../../shared/api/client';
import { errorMessage, useApiMutation } from '../../../../shared/api/useApi';
import { useT } from '../../../../shared/lib/useT';
import { ActionNote } from '../../../../shared/ui/ActionNote';
import { MemberLookup } from '../../../../shared/project/MemberLookup';
import styles from './Visibility.module.css';

export function VisibilityCheck({ projectId, revision }: { readonly projectId: string; readonly revision: number }) {
  const t = useT(), [name, setName] = useState('');
  const check = useApiMutation((userId: string) => api.projects.checkAppVisibility(projectId, userId));
  return <div className={styles.stack}>
    <p>{t('projects.visibility.checkHint')}</p>
    <MemberLookup projectId={projectId} disabled={check.isPending} actionKey="projects.visibility.checkUser" onSelect={(user) => { setName(user.name); check.mutate(user.userId); }} />
    {check.isError ? <ActionNote tone="error">{errorMessage(check.error)}</ActionNote> : null}
    {check.data ? <ActionNote tone="neutral">{t(check.data.visible ? 'projects.visibility.visible' : 'projects.visibility.hidden', { name, revision: check.data.revision })} · {t(`projects.visibility.basis.${check.data.basis}`)}{check.data.revision !== revision ? ` · ${t('projects.visibility.checkStale')}` : ''}</ActionNote> : null}
  </div>;
}
