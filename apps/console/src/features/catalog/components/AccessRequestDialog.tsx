import { useId, useState } from 'react';
import type { ReactElement } from 'react';
import type { ApiOperationDto } from '@crewstation/contracts';
import { useT } from '../../../shared/lib/useT';
import { FormField } from '../../../shared/ui/FormField';
import { FormDialog } from '../../../shared/ui/dialog/FormDialog';
import styles from './CatalogContent.module.css';

export interface AccessRequestDialogProps {
  readonly operation: ApiOperationDto;
  readonly reason: string;
  readonly pending: boolean;
  readonly error?: string;
  readonly onChange: (reason: string) => void;
  readonly onSubmit: () => void;
  readonly onClose: () => void;
}

/**
 * 定向开放申请的弹窗：写清申请哪一个操作，理由随申请提交，管理员批准或拒绝时会原样带回。
 * 理由是这个操作的草稿：取消、✕、Esc 只关窗；「清空」清掉理由。
 */
export function AccessRequestDialog({ operation, reason, pending, error, onChange, onSubmit, onClose }: AccessRequestDialogProps): ReactElement {
  const t = useT(), id = useId();
  const [submitted, setSubmitted] = useState(false);
  const invalid = submitted && reason.length > 500;
  const submit = (): void => { setSubmitted(true); if (!pending && reason.length <= 500) onSubmit(); };
  return <FormDialog title={t('catalog.request.action')} submitLabel={t('catalog.request.submit')} busyLabel={t('catalog.request.submitting')} busy={pending}
    error={error} dirty={reason !== ''} onClear={() => { onChange(''); setSubmitted(false); }} onClose={onClose} onSubmit={submit}>
    <p className={styles.requestTarget}><code>{operation.method} {operation.path}</code> · {operation.proxy}{operation.summary ? ` · ${operation.summary}` : ''}</p>
    <FormField label={t('catalog.request.reason')} hint={t('catalog.reason.hint')} hintId={`${id}-hint`} error={invalid ? t('catalog.reason.tooLong') : undefined} errorId={`${id}-error`}>
      <textarea rows={3} value={reason} disabled={pending} aria-invalid={invalid} aria-describedby={`${id}-hint`} aria-errormessage={invalid ? `${id}-error` : undefined}
        placeholder={t('catalog.request.reasonPlaceholder')} onChange={(event) => onChange(event.target.value)} />
    </FormField>
  </FormDialog>;
}
