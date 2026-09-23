import { useEffect, useId, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import type { MaintenanceDto, MaintenanceUser } from '@crewstation/contracts';
import { MAINTENANCE_LIMITS } from '@crewstation/contracts';
import { api } from '../../../shared/api/client';
import { errorMessage } from '../../../shared/api/useApi';
import { useT } from '../../../shared/lib/useT';
import { MemberLookup } from '../../../shared/project/MemberLookup';
import { ActionNote } from '../../../shared/ui/ActionNote';
import { ActionRow } from '../../../shared/ui/ActionRow';
import { Button } from '../../../shared/ui/Button';
import { FormField } from '../../../shared/ui/FormField';
import { MAINTENANCE_SWITCHES, draftFromMaintenance, emptyMaintenanceDraft, maintenanceDraftChanged, maintenanceRequest, validateMaintenanceDraft } from '../model/maintenanceDraft';
import type { MaintenanceDraft, MaintenanceDraftErrors } from '../model/maintenanceDraft';
import type { ReleaseActions } from '../model/useReleaseActions';
import styles from './Maintenance.module.css';

interface MaintenanceFormProps {
  readonly projectId: string;
  readonly serviceId: string;
  /** 打开表单时看到的维护：null 是进入维护；否则是调整，提交时带它的版本号（之后的轮询不改变这次确认）。 */
  readonly current: MaintenanceDto | null;
  readonly actions: ReleaseActions;
  /** 保存成功（带结果文案）或取消。 */
  readonly onClose: (done?: string) => void;
  /** 保存成功或失败后重读维护状态。 */
  readonly onSettled: () => Promise<unknown>;
}

/**
 * 进入或调整维护（RFC-021 M4、M6、M7、M13、B1）：三个开关默认全开，原因必填，预计恢复时间与临时放行的人选填。
 * 未提交的输入进页面的离开确认；别人先改过维护时服务端 409，提示后保留输入。
 */
export function MaintenanceForm({ projectId, serviceId, current, actions, onClose, onSettled }: MaintenanceFormProps): ReactElement {
  const t = useT(), id = useId(), reasonInput = useRef<HTMLTextAreaElement>(null), endInput = useRef<HTMLInputElement>(null);
  const [opened] = useState(() => ({ base: current ? draftFromMaintenance(current) : emptyMaintenanceDraft(), revision: current?.revision ?? 0 })), base = opened.base, updating = opened.revision > 0;
  const [draft, setDraft] = useState<MaintenanceDraft>(base), [errors, setErrors] = useState<MaintenanceDraftErrors>({});
  const [busy, setBusy] = useState(false), [error, setError] = useState<string>();
  const dirty = maintenanceDraftChanged(draft, base), { markDraft } = actions;
  useEffect(() => { markDraft('maintenance', dirty || busy); return () => markDraft('maintenance', false); }, [dirty, busy, markDraft]);
  const update = (patch: Partial<MaintenanceDraft>) => { setDraft((previous) => ({ ...previous, ...patch })); setError(undefined); };
  const addUser = (user: MaintenanceUser) => { if (!draft.allowUsers.some((item) => item.userId === user.userId)) update({ allowUsers: [...draft.allowUsers, { userId: user.userId, name: user.name, email: user.email }] }); };
  const submit = async () => {
    const found = validateMaintenanceDraft(draft, new Date()); setErrors(found);
    if (found.reason) { reasonInput.current?.focus(); return; }
    if (found.expectedEnd) { endInput.current?.focus(); return; }
    if (found.allowUsers || !actions.begin('maintenance')) return;
    setBusy(true); setError(undefined);
    try { await api.services.setMaintenance(serviceId, maintenanceRequest(draft, opened.revision)); markDraft('maintenance', false); onClose(t(updating ? 'release.maintenance.updated' : 'release.maintenance.entered')); }
    catch (cause) { setError(errorMessage(cause)); }
    finally { await onSettled(); setBusy(false); actions.finish('maintenance'); }
  };
  const fieldError = (field: keyof MaintenanceDraftErrors) => (errors[field] ? t(errors[field]!) : undefined);
  return <form className={styles.form} noValidate aria-label={t(updating ? 'release.maintenance.updateTitle' : 'release.maintenance.enterTitle')} onSubmit={(event) => { event.preventDefault(); void submit(); }}>
    <fieldset className={styles.switches} disabled={busy}>
      <legend className={styles.legend}>{t('release.maintenance.switchesLegend')}</legend>
      {MAINTENANCE_SWITCHES.map((key) => <label key={key} className={styles.switch}>
        <input type="checkbox" name={`maintenance-${key}`} checked={draft.switches[key]} onChange={(event) => update({ switches: { ...draft.switches, [key]: event.target.checked } })} />
        <span><strong>{t(`release.maintenance.switch.${key}`)}</strong><small className={styles.muted}>{t(`release.maintenance.switchHint.${key}`)}</small></span>
      </label>)}
    </fieldset>
    <FormField label={t('release.maintenance.reason')} hint={t('release.maintenance.reasonHint')} hintId={`${id}-reason-hint`} error={fieldError('reason')} errorId={`${id}-reason-error`}>
      <textarea ref={reasonInput} name="maintenanceReason" rows={2} value={draft.reason} disabled={busy} aria-invalid={!!errors.reason} aria-describedby={`${id}-reason-hint${errors.reason ? ` ${id}-reason-error` : ''}`} onChange={(event) => { update({ reason: event.target.value }); setErrors((previous) => ({ ...previous, reason: undefined })); }} />
    </FormField>
    <FormField label={t('release.maintenance.expectedEnd')} hint={t('release.maintenance.expectedEndHint')} hintId={`${id}-end-hint`} error={fieldError('expectedEnd')} errorId={`${id}-end-error`}>
      <input ref={endInput} type="datetime-local" name="maintenanceEnd" value={draft.expectedEnd} disabled={busy} aria-invalid={!!errors.expectedEnd} aria-describedby={`${id}-end-hint${errors.expectedEnd ? ` ${id}-end-error` : ''}`} onChange={(event) => { update({ expectedEnd: event.target.value }); setErrors((previous) => ({ ...previous, expectedEnd: undefined })); }} />
    </FormField>
    <div className={styles.people} role="group" aria-label={t('release.maintenance.allowUsers')}>
      <span className={styles.legend}>{t('release.maintenance.allowUsers')}</span>
      <small className={styles.muted}>{t('release.maintenance.allowUsersHint', { max: MAINTENANCE_LIMITS.allowUsers })}</small>
      {draft.allowUsers.length === 0 ? <small className={styles.muted}>{t('release.maintenance.noUsers')}</small> : <ul className={styles.list}>
        {draft.allowUsers.map((user) => <li key={user.userId} className={styles.person}><span>{user.name} · {user.email}</span>
          <Button size="small" disabled={busy} aria-label={t('release.maintenance.removeUserLabel', { name: user.name })} onClick={() => update({ allowUsers: draft.allowUsers.filter((item) => item.userId !== user.userId) })}>{t('release.maintenance.removeUser')}</Button></li>)}
      </ul>}
      <MemberLookup projectId={projectId} actionKey="release.maintenance.addUser" disabled={busy || draft.allowUsers.length >= MAINTENANCE_LIMITS.allowUsers} {...(errors.allowUsers ? { selectionError: t(errors.allowUsers) } : {})} onSelect={addUser} />
    </div>
    {error ? <ActionNote tone="error">{error}</ActionNote> : null}
    <ActionRow>
      <Button type="submit" variant="primary" disabled={busy}>{t(busy ? 'release.maintenance.saving' : updating ? 'release.maintenance.submitUpdate' : 'release.maintenance.submitEnter')}</Button>
      <Button variant="ghost" disabled={busy} onClick={() => onClose()}>{t('release.maintenance.cancel')}</Button>
    </ActionRow>
  </form>;
}
