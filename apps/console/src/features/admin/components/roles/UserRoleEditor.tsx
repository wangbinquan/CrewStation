import type { PlatformRole, UserDto } from '@crewstation/contracts';
import { useState } from 'react';
import { api } from '../../../../shared/api/client';
import { queryKeys } from '../../../../shared/api/queryKeys';
import { useApiMutation } from '../../../../shared/api/useApi';
import { useT } from '../../../../shared/lib/useT';
import { Button } from '../../../../shared/ui/Button';
import { ConfirmationPanel } from '../../../../shared/ui/ConfirmationPanel';
import { FormField } from '../../../../shared/ui/FormField';
import { ActionNote } from '../../../../shared/ui/ActionNote';

export function UserRoleEditor({ user, refresh }: { readonly user: UserDto; readonly refresh: () => void }) {
  const t = useT(), [selected, setSelected] = useState<PlatformRole>(user.platformRole), [confirming, setConfirming] = useState(false);
  const save = useApiMutation(() => api.users.setPlatformRole(user.id, { platformRole: selected, expectedRole: user.platformRole }), {
    invalidate: [queryKeys.users(), queryKeys.me()], onSuccess: () => setConfirming(false),
  });
  return <>
    <FormField label={t('admin.users.roleFor', { name: user.name })}>
      <select value={selected} disabled={save.isPending} onChange={(e) => { setSelected(e.target.value as PlatformRole); setConfirming(false); save.reset(); }}>
        {(['user', 'developer', 'admin'] as const).map((role) => <option key={role} value={role}>{t(`topBar.role.${role}`)}</option>)}
      </select>
    </FormField>
    {!confirming ? <Button disabled={selected === user.platformRole || save.isPending} onClick={() => setConfirming(true)}>{t('admin.users.saveRole')}</Button> : null}
    {confirming ? <ConfirmationPanel question={t('admin.users.roleQuestion', { name: user.name, role: t(`topBar.role.${selected}`) })}
      hint={t('admin.users.roleHint')} confirmLabel={t(save.isPending ? 'admin.users.saving' : 'admin.users.saveRole')} cancelLabel={t('admin.users.cancelRole')}
      busy={save.isPending} onConfirm={() => save.mutate()} onCancel={() => setConfirming(false)} /> : null}
    {save.error ? <ActionNote tone="error">{save.error.message}{save.error.status === 409 ? <Button onClick={refresh}>{t('admin.users.refreshRole')}</Button> : null}</ActionNote> : null}
  </>;
}
