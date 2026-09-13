import { useId, useState } from 'react';
import type { FormEvent, ReactElement } from 'react';
import { useT } from '../../../shared/lib/useT';
import { Button } from '../../../shared/ui/Button';
import { FormField } from '../../../shared/ui/FormField';
import { ActionNote } from '../../../shared/ui/ActionNote';
import styles from './OperationsPanel.module.css';

export interface AccessRequestFormProps {
  readonly pending: boolean;
  readonly error?: string;
  readonly onSubmit: (reason: string) => void;
  readonly onCancel: () => void;
}

/** 定向开放申请的行内表单：理由随申请提交，管理员批准或拒绝时会原样带回。 */
export function AccessRequestForm({ pending, error, onSubmit, onCancel }: AccessRequestFormProps): ReactElement {
  const t = useT();
  const [reason, setReason] = useState('');
  const [submitted, setSubmitted] = useState(false), id = useId();
  const invalid = submitted && reason.length > 500;
  const submit = (event: FormEvent): void => {
    event.preventDefault();
    setSubmitted(true);
    if (pending || reason.length > 500) return;
    onSubmit(reason);
  };
  return (
    <form className={styles.inlineForm} onSubmit={submit} noValidate>
      <FormField label={t('catalog.request.reason')} hint={t('catalog.reason.hint')} hintId={`${id}-hint`} error={invalid ? t('catalog.reason.tooLong') : undefined} errorId={`${id}-error`}>
        <textarea
          className={styles.textarea}
          rows={2}
          value={reason}
          disabled={pending}
          aria-invalid={invalid} aria-describedby={`${id}-hint`} aria-errormessage={invalid ? `${id}-error` : undefined}
          placeholder={t('catalog.request.reasonPlaceholder')}
          onChange={(e) => setReason(e.target.value)}
        />
      </FormField>
      {error ? <ActionNote tone="error">{error}</ActionNote> : null}
      <div className={styles.inlineButtons}>
        <Button variant="primary" type="submit" disabled={pending}>
          {pending ? t('catalog.request.submitting') : t('catalog.request.submit')}
        </Button>
        <Button variant="ghost" onClick={onCancel} disabled={pending}>
          {t('catalog.request.cancel')}
        </Button>
      </div>
    </form>
  );
}
