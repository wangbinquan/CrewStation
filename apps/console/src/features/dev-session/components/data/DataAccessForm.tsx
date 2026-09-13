import { useEffect, useId, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { TaskDataMode } from '@crewstation/contracts';
import { useT } from '../../../../shared/lib/useT';
import { FormField } from '../../../../shared/ui/FormField';
import { Button } from '../../../../shared/ui/Button';
import { ActionNote } from '../../../../shared/ui/ActionNote';
import { errorMessage } from '../../../../shared/api/useApi';
import type { DataBindingsHandle } from '../../hooks/useDataBindings';
import { TASK_DATA_MODES } from '../../model/agentOptions';
import { validateDataAccess } from '../../model/dataAccessForm';
import type { DataAccessDraft } from '../../model/dataAccessForm';

const INITIAL: DataAccessDraft = { mode: 'diagnostic-readonly', reason: '', ttl: '' };
export function DataAccessForm({ data, onDirtyChange }: { readonly data: DataBindingsHandle; readonly onDirtyChange: (dirty: boolean) => void }) {
  const t = useT(), id = useId(), form = useRef<HTMLFormElement>(null), lock = useRef(false);
  const [draft, setDraft] = useState(INITIAL), [baseline, setBaseline] = useState(INITIAL);
  const [errors, setErrors] = useState<{ reason?: string; ttl?: string }>({});
  const dirty = draft.reason !== baseline.reason || draft.mode !== baseline.mode || draft.ttl !== baseline.ttl;
  useEffect(() => { onDirtyChange(dirty); return () => onDirtyChange(false); }, [dirty, onDirtyChange]);
  const disabled = !data.canRequest || data.busy || data.isPending || !!data.loadError;
  const submit = async (event: FormEvent) => {
    event.preventDefault(); if (disabled || lock.current) return;
    const checked = validateDataAccess(draft); setErrors(checked.errors);
    if (!checked.input) { queueMicrotask(() => form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()); return; }
    lock.current = true;
    try { await data.requestAccess(checked.input); const clean = { ...draft, reason: '' }; setDraft(clean); setBaseline(clean); }
    catch { /* 请求错误由真实 mutation 回执呈现，保留输入。 */ }
    finally { lock.current = false; }
  };
  return <form ref={form} noValidate onSubmit={(event) => void submit(event)}>
    <FormField label={t('devSession.data.request')} hint={t('devSession.data.modeHint')}>
      <select value={draft.mode} disabled={disabled} onChange={(event) => { setDraft({ ...draft, mode: event.target.value as TaskDataMode }); setErrors({}); }}>{TASK_DATA_MODES.map((mode) => <option key={mode} value={mode}>{t(`devSession.data.mode.${mode}`)}</option>)}</select>
    </FormField>
    <FormField label={t('devSession.data.reason')} hint={t('devSession.data.reasonHint')} hintId={`${id}-reason-hint`} error={errors.reason ? t(errors.reason) : undefined} errorId={`${id}-reason-error`}>
      <textarea value={draft.reason} rows={2} disabled={disabled} aria-invalid={!!errors.reason} aria-describedby={`${id}-reason-hint${errors.reason ? ` ${id}-reason-error` : ''}`} aria-errormessage={errors.reason ? `${id}-reason-error` : undefined} onChange={(event) => { setDraft({ ...draft, reason: event.target.value }); setErrors({ ...errors, reason: undefined }); }} />
    </FormField>
    {draft.mode !== 'development' ? <FormField label={t('devSession.data.ttl')} hint={t('devSession.data.ttlHint')} hintId={`${id}-ttl-hint`} error={errors.ttl ? t(errors.ttl) : undefined} errorId={`${id}-ttl-error`}>
      <input value={draft.ttl} inputMode="numeric" disabled={disabled} placeholder="120" aria-invalid={!!errors.ttl} aria-describedby={`${id}-ttl-hint${errors.ttl ? ` ${id}-ttl-error` : ''}`} aria-errormessage={errors.ttl ? `${id}-ttl-error` : undefined} onChange={(event) => { setDraft({ ...draft, ttl: event.target.value }); setErrors({ ...errors, ttl: undefined }); }} />
    </FormField> : <p>{t('devSession.data.developmentLifetime')}</p>}
    <Button type="submit" variant="primary" disabled={disabled}>{t(data.request.isPending ? 'devSession.data.pending' : 'devSession.data.submit')}</Button>
    {!data.canRequest ? <ActionNote tone="neutral">{t(data.hasService ? 'devSession.data.noDevelop' : 'devSession.data.noService')}</ActionNote> : null}
    {data.request.error ? <ActionNote tone="error">{errorMessage(data.request.error)}</ActionNote> : null}
    {data.request.isSuccess ? <ActionNote tone="success">{t('devSession.data.requested', { mode: t(`devSession.data.mode.${data.request.data.mode}`) })} {t(`devSession.data.state.${data.request.data.state}`)}</ActionNote> : null}
  </form>;
}
