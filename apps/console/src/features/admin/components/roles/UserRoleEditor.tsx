import type { PlatformRole, UserDto } from '@crewstation/contracts';
import { useEffect, useRef, useState } from 'react';
import { api } from '../../../../shared/api/client';
import { queryKeys } from '../../../../shared/api/queryKeys';
import { errorMessage, useApiMutation } from '../../../../shared/api/useApi';
import { useT } from '../../../../shared/lib/useT';
import { ActionNote } from '../../../../shared/ui/ActionNote';
import { Badge } from '../../../../shared/ui/Badge';
import { Button } from '../../../../shared/ui/Button';
import { ConfirmationDialog } from '../../../../shared/ui/dialog/ConfirmationDialog';
import { FormDialog } from '../../../../shared/ui/dialog/FormDialog';
import { ChoiceField } from '../../../../shared/ui/selection/ChoiceField';
import styles from './Users.module.css';

export interface UserRoleEditorProps {
  readonly user: UserDto;
  /** 弹窗开着；关着时组件仍挂载，选好的角色留着（2026-09-23 裁定关窗不丢草稿）。 */
  readonly open: boolean;
  readonly refresh: () => Promise<UserDto | undefined>;
  readonly onSaved: () => void;
  readonly onDirtyChange: (dirty: boolean) => void;
  /** ✕、取消、Esc：只关窗。 */
  readonly onClose: () => void;
}

/**
 * 一位用户的平台角色（2026-09-23 起由目录旁的编辑栏改为弹窗）：选好角色后「检查变更」，确认弹窗叠在上面；
 * 保存失败时确认弹窗收起、原因留在角色弹窗里，撞上别人刚改过（409）要先「重新读取当前角色」再确认。
 * 「清空」回到当前角色（重新读取过就是读到的那个）。
 */
export function UserRoleEditor({ user, open, refresh, onSaved, onDirtyChange, onClose }: UserRoleEditorProps) {
  const t = useT(), options = useRef<HTMLFieldSetElement>(null);
  const [baseline, setBaseline] = useState(user), [selected, setSelected] = useState<PlatformRole>(user.platformRole);
  const [confirming, setConfirming] = useState(false), [conflict, setConflict] = useState(false);
  const [refreshing, setRefreshing] = useState(false), [refreshError, setRefreshError] = useState('');
  const save = useApiMutation(() => api.users.setPlatformRole(user.id, { platformRole: selected, expectedRole: baseline.platformRole }), {
    invalidate: [queryKeys.users(), queryKeys.me()], onSuccess: onSaved,
  });
  const dirty = selected !== baseline.platformRole;
  useEffect(() => { onDirtyChange(dirty || save.isPending); return () => onDirtyChange(false); }, [dirty, save.isPending, onDirtyChange]);
  // 单选组的键盘约定：打开时焦点落在当前选中的角色上，不是第一项。
  useEffect(() => { if (open) options.current?.querySelector<HTMLInputElement>('input:checked')?.focus(); }, [open]);
  const reload = async () => {
    setRefreshing(true); setRefreshError('');
    try {
      const current = await refresh();
      if (!current) { setRefreshError(t('admin.users.unavailable')); return; }
      setBaseline(current); setConflict(false); setConfirming(false); save.reset();
    } catch (error) { setRefreshError(errorMessage(error)); }
    finally { setRefreshing(false); }
  };
  const clear = () => { setSelected(baseline.platformRole); setConfirming(false); if (!conflict) save.reset(); };
  if (!open) return null;
  return <>
    <FormDialog title={t('admin.users.manageFor', { name: baseline.name, email: baseline.email || user.id })} submitLabel={t('admin.users.review')} busy={save.isPending} submitDisabled={!dirty || refreshing || conflict}
      error={save.error ? `${save.error.message} ${t('admin.identity.http', { status: save.error.status })}` : undefined} dirty={dirty} onClear={clear} onClose={onClose} onSubmit={() => setConfirming(true)}
      actions={conflict ? <Button disabled={refreshing} onClick={() => void reload()}>{t('admin.users.refreshRole')}</Button> : undefined}>
      <div className={styles.details}><strong>{baseline.name}</strong><span className={styles.muted}>{baseline.email || t('admin.users.noEmail')}</span><code className={styles.muted}>{user.id}</code></div>
      <fieldset ref={options} className={styles.options} disabled={save.isPending || refreshing}><legend>{t('admin.users.roleFor', { name: baseline.name })}</legend>
        {(['user', 'developer', 'admin'] as const).map((role) => <ChoiceField key={role} type="radio" name={`role-${user.id}`} value={role} checked={selected === role} label={t(`topBar.role.${role}`)} description={t(`admin.users.description.${role}`)} onChange={() => { setSelected(role); if (!conflict) save.reset(); }} />)}
      </fieldset>
      <p className={styles.muted}>{t('admin.users.roleHint')}</p>
      {refreshError ? <ActionNote tone="error">{refreshError}</ActionNote> : null}
    </FormDialog>
    {confirming ? <ConfirmationDialog question={t('admin.users.roleQuestion', { name: baseline.name, role: t(`topBar.role.${selected}`) })}
      confirmLabel={t('admin.users.saveRole')} busyLabel={t('admin.users.saving')} cancelLabel={t('admin.users.cancelRole')} busy={save.isPending} confirmDisabled={conflict}
      onConfirm={() => save.mutate(undefined, { onError: (error) => { setConfirming(false); if (error.status === 409) setConflict(true); } })} onCancel={() => setConfirming(false)}>
      <div className={styles.change}><Badge>{t(`topBar.role.${baseline.platformRole}`)}</Badge><span aria-hidden="true">→</span><Badge tone="info">{t(`topBar.role.${selected}`)}</Badge></div>
    </ConfirmationDialog> : null}
  </>;
}
