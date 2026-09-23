import { useEffect, useId, useRef } from 'react';
import { useT } from '../../../shared/lib/useT';
import { FormField } from '../../../shared/ui/FormField';
import { QueryStatus } from '../../../shared/ui/QueryStatus';
import { FormDialog } from '../../../shared/ui/dialog/FormDialog';
import type { AlertSubscriptions } from '../hooks/useAlertSubscriptions';
import styles from './Alerts.module.css';

/**
 * 添加或编辑通知订阅的弹窗（2026-09-23 起由卡片里的行内表单改为弹窗）：提交先重读核对，核对结果在叠上来的确认弹窗里；
 * 草稿在 useAlertSubscriptions 里，取消、✕、Esc 只关窗，再点同一个入口恢复。
 */
export function AlertSubscriptionDialog({ p }: { readonly p: AlertSubscriptions }) {
  const t = useT(), id = useId(), fields = useRef<HTMLDivElement>(null), disabled = p.busy || !!p.review || !!p.replacement || !p.canManage;
  useEffect(() => { if (Object.keys(p.errors).length) fields.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(); }, [p.errors]);
  const change = (key: 'userId' | 'target', value: string) => { p.setDraft({ ...p.draft, [key]: value }); p.setErrors({ ...p.errors, [key]: undefined }); };
  return <FormDialog title={p.editing ? t('logs.alerts.subscription.edit', { name: p.name(p.draft.userId) }) : t('logs.alerts.subscription.add')}
    submitLabel={t('logs.alerts.subscription.review')} busyLabel={t('logs.alerts.subscription.busy')} busy={p.busy} submitDisabled={disabled || p.unavailable}
    error={p.review ? undefined : p.error} dirty={p.dirty} onClear={p.clear} onClose={p.close} onSubmit={() => void p.prepare()}>
    <div ref={fields} className={styles.form} aria-label={t('logs.alerts.subscription.form')} role="group">
      {p.editing ? <p>{t('logs.alerts.subscription.editing', { name: p.name(p.draft.userId) })}</p> : <>
        <QueryStatus isPending={p.members.isPending} error={p.members.error} />
        <FormField label={t('logs.alerts.subscription.member')} hint={t('logs.alerts.subscription.memberHint')}>
          <select name="alertMember" value={p.members.data?.items.some((member) => member.userId === p.draft.userId) ? p.draft.userId : ''} disabled={disabled || p.members.isPending || !!p.members.error} onChange={(event) => change('userId', event.target.value)}>
            <option value="">{t('logs.alerts.subscription.chooseMember')}</option>{p.members.data?.items.map((member) => <option key={member.userId} value={member.userId}>{member.name} · {member.email}</option>)}
          </select>
        </FormField>
      </>}
      <FormField label={t('logs.alerts.subscription.userId')} hint={t('logs.alerts.subscription.userHint')} hintId={`${id}-user-hint`} error={p.errors.userId ? t(p.errors.userId) : undefined} errorId={`${id}-user-error`}>
        <input name="alertUserId" value={p.draft.userId} disabled={disabled || p.editing} aria-invalid={!!p.errors.userId} aria-describedby={`${id}-user-hint${p.errors.userId ? ` ${id}-user-error` : ''}`} aria-errormessage={p.errors.userId ? `${id}-user-error` : undefined} onChange={(event) => change('userId', event.target.value)} />
      </FormField>
      <FormField label={t('logs.alerts.subscription.channel')} hint={t('logs.alerts.subscription.channelHint')}>
        <select name="alertChannel" value={p.draft.channel} disabled={disabled} onChange={(event) => { p.setDraft({ ...p.draft, channel: event.target.value === 'webhook' ? 'webhook' : 'workbench' }); p.setErrors({ ...p.errors, target: undefined }); }}>
          <option value="workbench">{t('logs.alerts.channel.workbench')}</option><option value="webhook">Webhook</option>
        </select>
      </FormField>
      {p.draft.channel === 'webhook' ? <FormField label={t('logs.alerts.subscription.target')} hint={t('logs.alerts.subscription.targetHint')} hintId={`${id}-target-hint`} error={p.errors.target ? t(p.errors.target) : undefined} errorId={`${id}-target-error`}>
        <input name="alertTarget" value={p.draft.target} disabled={disabled} aria-invalid={!!p.errors.target} aria-describedby={`${id}-target-hint${p.errors.target ? ` ${id}-target-error` : ''}`} aria-errormessage={p.errors.target ? `${id}-target-error` : undefined} onChange={(event) => change('target', event.target.value)} />
      </FormField> : null}
    </div>
  </FormDialog>;
}
