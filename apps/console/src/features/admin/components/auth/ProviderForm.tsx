import type { CreateOidcProviderRequest, OidcProviderDto } from '@crewstation/contracts';
import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { useT } from '../../../../shared/lib/useT';
import { UnsavedChangesGuard } from '../../../../shared/navigation/UnsavedChangesGuard';
import { Tabs } from '../../../../shared/ui/Tabs';
import { FormDialog } from '../../../../shared/ui/dialog/FormDialog';
import { useProviderDraft } from '../../hooks/useProviderDraft';
import { providerFieldGroup, providerGroups } from '../../model/providerDraft';
import type { ProviderGroup } from '../../model/providerDraft';
import { ProviderFields } from './provider/ProviderFields';
import styles from './IdentityAdmin.module.css';

export interface ProviderFormProps {
  readonly initial?: OidcProviderDto;
  /** 弹窗开着；关着时组件仍挂载，草稿与离开确认都在（2026-09-23 裁定关窗不丢草稿）。 */
  readonly open: boolean;
  readonly busy: boolean;
  readonly error?: ReactNode;
  /** 取消之后的按钮，如编辑时的「删除此接入方」。 */
  readonly actions?: ReactNode;
  readonly onSubmit: (body: CreateOidcProviderRequest) => void;
  readonly onDirtyChange: (dirty: boolean) => void;
  /** ✕、取消、Esc：只关窗。 */
  readonly onClose: () => void;
  /** 清空：同一个接入方重新起一份表单。 */
  readonly onClear: () => void;
}

/** 新增或编辑身份提供方的大弹窗：四个分组页签；提交时出错的分组自动切到前面，焦点落到第一个出错的字段。 */
export function ProviderForm({ initial, open, busy, error, actions, onSubmit, onDirtyChange, onClose, onClear }: ProviderFormProps) {
  const t = useT(), draft = useProviderDraft(initial), fields = useRef<HTMLDivElement>(null);
  useEffect(() => { onDirtyChange(draft.dirty || busy); return () => onDirtyChange(false); }, [draft.dirty, busy, onDirtyChange]);
  useEffect(() => { if (draft.attempt) fields.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(); }, [draft.attempt]);
  return <>
    <UnsavedChangesGuard dirty={draft.dirty || busy} scope={initial?.displayName ?? t('admin.auth.providerNew')} isNavigationBusy={() => busy} />
    {open ? <FormDialog size="large" title={initial ? initial.displayName : t('admin.auth.providerNew')} submitLabel={t(initial ? 'admin.auth.providerSave' : 'admin.auth.providerAdd')} busyLabel={t('admin.auth.saving')}
      busy={busy} error={error} dirty={draft.dirty} actions={actions} onClear={onClear} onClose={onClose} onSubmit={() => { if (busy) return; const body = draft.validate(); if (body) onSubmit(body); }}>
      <p className={styles.muted}>{t('admin.auth.providerNote')}</p>
      <div ref={fields}><Tabs label={t('admin.identity.providerGroups')} value={draft.group} onChange={(group) => draft.setGroup(group as ProviderGroup)} items={providerGroups.map((group) => {
        const count = Object.keys(draft.errors).filter((key) => providerFieldGroup(key) === group).length;
        return { value: group, label: `${t(`admin.identity.group.${group}`)}${count ? ` · ${t(count === 1 ? 'admin.identity.error' : 'admin.identity.errors', { count })}` : ''}` };
      })}><fieldset disabled={busy} className={styles.bare}><ProviderFields draft={draft} editing={Boolean(initial)} secretSet={initial?.clientSecretSet ?? false} /></fieldset></Tabs></div>
    </FormDialog> : null}
  </>;
}
