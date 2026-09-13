import type { ApiOperationDto } from '@crewstation/contracts';
import { useId, useRef, useState } from 'react';
import { useT } from '../../../../shared/lib/useT';
import { Button } from '../../../../shared/ui/Button';
import { Card } from '../../../../shared/ui/Card';
import { FormField } from '../../../../shared/ui/FormField';
import type { ApiInvocationController } from '../../hooks/useApiInvocation';
import { apiPathParameterNames, emptyApiInvocationDraft, validateApiInvocationDraft } from '../../hooks/apiInvocationDraft';
import type { ApiInvocationDraft } from '../../hooks/apiInvocationDraft';
import formStyles from '../OperationsPanel.module.css';
import styles from './ApiInvocation.module.css';

export function ApiInvocationForm({ operation, controller, onClose }: { readonly operation: ApiOperationDto; readonly controller: ApiInvocationController; readonly onClose: () => void }) {
  const t = useT(), id = useId(), form = useRef<HTMLFormElement>(null);
  const [draft, setDraft] = useState(() => emptyApiInvocationDraft(operation)), [submitted, setSubmitted] = useState(false);
  const validated = validateApiInvocationDraft(operation, controller.taskId, draft), errors = submitted ? validated.errors : {};
  const change = (delta: Partial<ApiInvocationDraft>) => { setDraft((current) => ({ ...current, ...delta })); controller.markDirty('detail'); };
  const send = () => {
    setSubmitted(true);
    if (!validated.input) { queueMicrotask(() => form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()); return; }
    void controller.send('detail', validated.input).catch(controller.reportError);
  };
  return <Card compact title={<>{t('catalog.invoke.detail')} <code>{operation.method} {operation.path}</code></>} extra={<Button onClick={onClose}>{t('catalog.invoke.hide')}</Button>}>
    <form ref={form} className={styles.form} noValidate onSubmit={(event) => { event.preventDefault(); send(); }}>
      <p className={styles.note}>{operation.summary ?? operation.key}</p>
      <div className={styles.parameters}>
        {apiPathParameterNames(operation.path).map((name, index) => <FormField key={name} label={t('catalog.invoke.pathLabel', { name })} hint={t('catalog.invoke.pathHint')} error={errors[`path:${name}`] ? t(errors[`path:${name}`]!) : undefined} hintId={`${id}-path-hint-${index}`} errorId={`${id}-path-error-${index}`}>
          <input className={formStyles.textarea} value={draft.pathParameters[name] ?? ''} disabled={controller.pending} aria-invalid={!!errors[`path:${name}`]} aria-describedby={`${id}-path-hint-${index}`} aria-errormessage={errors[`path:${name}`] ? `${id}-path-error-${index}` : undefined} onChange={(event) => change({ pathParameters: { ...draft.pathParameters, [name]: event.target.value } })} />
        </FormField>)}
      </div>
      <div className={styles.parameters}>
        {(['query', 'headers'] as const).map((field) => <FormField key={field} label={t(`catalog.invoke.${field}`)} hint={t(`catalog.invoke.${field}Hint`)} error={errors[field] ? t(errors[field]!) : undefined} hintId={`${id}-${field}-hint`} errorId={`${id}-${field}-error`}>
          <textarea className={formStyles.textarea} rows={3} value={draft[field]} disabled={controller.pending} aria-invalid={!!errors[field]} aria-describedby={`${id}-${field}-hint`} aria-errormessage={errors[field] ? `${id}-${field}-error` : undefined} onChange={(event) => change({ [field]: event.target.value })} />
        </FormField>)}
      </div>
      <label><input type="checkbox" checked={draft.includeBody} disabled={controller.pending || ['GET', 'HEAD'].includes(operation.method)} onChange={(event) => change({ includeBody: event.target.checked })} /> {t('catalog.invoke.includeBody')}</label>
      <FormField label={t('catalog.invoke.body')} hint={t(['GET', 'HEAD'].includes(operation.method) ? 'catalog.invoke.bodyOmitted' : 'catalog.invoke.bodyHint')} error={errors.body ? t(errors.body) : undefined} hintId={`${id}-body-hint`} errorId={`${id}-body-error`}>
        <textarea className={formStyles.textarea} rows={4} value={draft.body} disabled={controller.pending || !draft.includeBody} aria-invalid={!!errors.body} aria-describedby={`${id}-body-hint`} aria-errormessage={errors.body ? `${id}-body-error` : undefined} onChange={(event) => change({ body: event.target.value })} />
      </FormField>
      {errors.session || errors.request ? <p role="alert">{t((errors.session ?? errors.request)!)}</p> : null}
      <div><Button variant="primary" type="submit" disabled={controller.pending || controller.checking}>{t(controller.pending ? 'catalog.invoke.sending' : 'catalog.invoke.send')}</Button></div>
    </form>
  </Card>;
}
