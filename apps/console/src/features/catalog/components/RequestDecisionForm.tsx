import { useId, useState } from 'react';
import type { ReactElement } from 'react';
import { useT } from '../../../shared/lib/useT';
import { Button } from '../../../shared/ui/Button';
import { FormField } from '../../../shared/ui/FormField';
import styles from './RequestsPanel.module.css';

export interface RequestDecisionFormProps {
  readonly pending: boolean;
  readonly onDecide: (approve: boolean, decision: string | undefined) => void;
}

/** 管理员审批：批准与拒绝都可带理由，理由随申请回给业务方，业务方才知道被拒的原因。 */
export function RequestDecisionForm({ pending, onDecide }: RequestDecisionFormProps): ReactElement {
  const t = useT();
  const [decision, setDecision] = useState('');
  const [submitted, setSubmitted] = useState(false), id = useId();
  const invalid = submitted && decision.length > 500;
  const decide = (approve: boolean): void => { setSubmitted(true); if (!pending && decision.length <= 500) onDecide(approve, decision.length > 0 ? decision : undefined); };
  return (
    <div className={styles.decisionForm}>
      <FormField label={t('catalog.requests.decision')} hint={t('catalog.reason.hint')} hintId={`${id}-hint`} error={invalid ? t('catalog.reason.tooLong') : undefined} errorId={`${id}-error`}><textarea
        className={styles.textarea}
        rows={2}
        value={decision}
        disabled={pending} aria-invalid={invalid} aria-describedby={`${id}-hint`} aria-errormessage={invalid ? `${id}-error` : undefined}
        placeholder={t('catalog.admin.decisionPlaceholder')}
        onChange={(e) => setDecision(e.target.value)}
      /></FormField>
      <div className={styles.decisionButtons}>
        <Button variant="primary" disabled={pending} onClick={() => decide(true)}>
          {t('catalog.admin.approve')}
        </Button>
        <Button disabled={pending} onClick={() => decide(false)}>
          {t('catalog.admin.reject')}
        </Button>
      </div>
    </div>
  );
}
