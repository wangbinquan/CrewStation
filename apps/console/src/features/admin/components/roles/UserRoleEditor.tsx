import type { PlatformRole, UserDto } from '@crewstation/contracts';
import { useEffect, useRef, useState } from 'react';
import { api } from '../../../../shared/api/client';
import { queryKeys } from '../../../../shared/api/queryKeys';
import { errorMessage, useApiMutation } from '../../../../shared/api/useApi';
import { useT } from '../../../../shared/lib/useT';
import { ActionNote } from '../../../../shared/ui/ActionNote';
import { Badge } from '../../../../shared/ui/Badge';
import { Button } from '../../../../shared/ui/Button';
import { Card } from '../../../../shared/ui/Card';
import { ConfirmationPanel } from '../../../../shared/ui/ConfirmationPanel';
import { ChoiceField } from '../../../../shared/ui/selection/ChoiceField';
import styles from './Users.module.css';

export function UserRoleEditor({ user, refresh, onClose }: { readonly user: UserDto; readonly refresh: () => Promise<UserDto | undefined>; readonly onClose: () => void }) {
  const t = useT(), root = useRef<HTMLDivElement>(null);
  const [baseline, setBaseline] = useState(user), [selected, setSelected] = useState<PlatformRole>(user.platformRole);
  const [confirming, setConfirming] = useState(false), [conflict, setConflict] = useState(false);
  const [refreshing, setRefreshing] = useState(false), [refreshError, setRefreshError] = useState('');
  const save = useApiMutation(() => api.users.setPlatformRole(user.id, { platformRole: selected, expectedRole: baseline.platformRole }), {
    invalidate: [queryKeys.users(), queryKeys.me()], onSuccess: onClose,
  });
  useEffect(() => { root.current?.querySelector<HTMLInputElement>('input:checked')?.focus(); }, []);
  const reload = async () => {
    setRefreshing(true); setRefreshError('');
    try {
      const current = await refresh();
      if (!current) { setRefreshError(t('admin.users.unavailable')); return; }
      setBaseline(current); setConflict(false); setConfirming(false); save.reset();
    } catch (error) { setRefreshError(errorMessage(error)); }
    finally { setRefreshing(false); }
  };
  return <div ref={root}><Card stacked title={t('admin.users.manage')} extra={<Button variant="ghost" disabled={save.isPending || refreshing} onClick={onClose}>{t('admin.identity.close')}</Button>}>
    <div className={styles.details}><strong>{baseline.name}</strong><span className={styles.muted}>{baseline.email || t('admin.users.noEmail')}</span><code className={styles.muted}>{user.id}</code></div>
    <fieldset className={styles.options} disabled={save.isPending || refreshing}><legend>{t('admin.users.roleFor', { name: baseline.name })}</legend>
      {(['user', 'developer', 'admin'] as const).map((role) => <ChoiceField key={role} type="radio" name={`role-${user.id}`} value={role} checked={selected === role} label={t(`topBar.role.${role}`)} description={t(`admin.users.description.${role}`)} onChange={() => { setSelected(role); setConfirming(false); if (!conflict) save.reset(); }} />)}
    </fieldset>
    <p className={styles.muted}>{t('admin.users.roleHint')}</p>
    {!confirming ? <Button variant="primary" disabled={selected === baseline.platformRole || save.isPending || refreshing || conflict} onClick={() => setConfirming(true)}>{t('admin.users.review')}</Button> : <ConfirmationPanel
      question={t('admin.users.roleQuestion', { name: baseline.name, role: t(`topBar.role.${selected}`) })}
      confirmLabel={t(save.isPending ? 'admin.users.saving' : 'admin.users.saveRole')} cancelLabel={t('admin.users.cancelRole')} busy={save.isPending} confirmDisabled={conflict}
      onConfirm={() => save.mutate(undefined, { onError: (error) => { if (error.status === 409) { setConflict(true); setConfirming(false); } } })} onCancel={() => setConfirming(false)}>
      <div className={styles.change}><Badge>{t(`topBar.role.${baseline.platformRole}`)}</Badge><span aria-hidden="true">→</span><Badge tone="info">{t(`topBar.role.${selected}`)}</Badge></div>
    </ConfirmationPanel>}
    {save.error ? <ActionNote tone="error">{save.error.message} {t('admin.identity.http', { status: save.error.status })}</ActionNote> : null}
    {conflict ? <Button disabled={refreshing} onClick={() => void reload()}>{t('admin.users.refreshRole')}</Button> : null}
    {refreshError ? <ActionNote tone="error">{refreshError}</ActionNote> : null}
  </Card></div>;
}
