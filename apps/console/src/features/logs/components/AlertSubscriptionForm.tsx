import { useEffect, useId, useRef } from 'react';
import { useT } from '../../../shared/lib/useT';
import { FormField } from '../../../shared/ui/FormField';
import { Button } from '../../../shared/ui/Button';
import { QueryStatus } from '../../../shared/ui/QueryStatus';
import type { AlertSubscriptions } from '../hooks/useAlertSubscriptions';
import styles from './Alerts.module.css';

export function AlertSubscriptionForm({ p }: { readonly p: AlertSubscriptions }) {
  const t = useT(), id = useId(), form = useRef<HTMLFormElement>(null), disabled = p.busy || !!p.review || !!p.replacement || !p.canManage;
  useEffect(() => { if (Object.keys(p.errors).length) form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(); }, [p.errors]);
  const change = (key: 'userId' | 'target', value: string) => { p.setDraft({ ...p.draft, [key]: value }); p.setErrors({ ...p.errors, [key]: undefined }); };
  return <form ref={form} noValidate aria-label={t('logs.alerts.subscription.form')} className={styles.form} onSubmit={(event) => { event.preventDefault(); void p.prepare(); }}>
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
    <Button type="submit" variant="primary" disabled={disabled || p.unavailable}>{t(p.busy ? 'logs.alerts.subscription.busy' : 'logs.alerts.subscription.review')}</Button>
    <Button disabled={disabled} onClick={p.close}>{t('logs.alerts.subscription.close')}</Button>
  </form>;
}
