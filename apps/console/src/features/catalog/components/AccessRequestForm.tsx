import { useState } from 'react';
import type { FormEvent, ReactElement } from 'react';
import { useT } from '../../../shared/lib/useT';
import { Button } from '../../../shared/ui/Button';
import styles from './OperationsPanel.module.css';

export interface AccessRequestFormProps {
  readonly pending: boolean;
  readonly onSubmit: (reason: string) => void;
  readonly onCancel: () => void;
}

/** 定向开放申请的行内表单：理由随申请提交，管理员批准或拒绝时会原样带回。 */
export function AccessRequestForm({ pending, onSubmit, onCancel }: AccessRequestFormProps): ReactElement {
  const t = useT();
  const [reason, setReason] = useState('');
  const submit = (event: FormEvent): void => {
    event.preventDefault();
    onSubmit(reason);
  };
  return (
    <form className={styles.inlineForm} onSubmit={submit}>
      <label className={styles.inlineField}>
        <span className={styles.filterLabel}>{t('catalog.request.reason')}</span>
        <textarea
          className={styles.textarea}
          rows={2}
          value={reason}
          placeholder={t('catalog.request.reasonPlaceholder')}
          onChange={(e) => setReason(e.target.value)}
        />
      </label>
      <div className={styles.inlineButtons}>
        <Button variant="primary" type="submit" disabled={pending}>
          {pending ? t('catalog.request.submitting') : t('catalog.request.submit')}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          {t('catalog.request.cancel')}
        </Button>
      </div>
    </form>
  );
}
