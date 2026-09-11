import { useState } from 'react';
import type { ReactElement } from 'react';
import { useT } from '../../../shared/lib/useT';
import { Button } from '../../../shared/ui/Button';
import styles from './RequestsPanel.module.css';

export interface RequestDecisionFormProps {
  readonly pending: boolean;
  readonly onDecide: (approve: boolean, decision: string | undefined) => void;
}

/** 管理员审批：批准与拒绝都可带理由，理由随申请回给业务方，业务方才知道被拒的原因。 */
export function RequestDecisionForm({ pending, onDecide }: RequestDecisionFormProps): ReactElement {
  const t = useT();
  const [decision, setDecision] = useState('');
  const decide = (approve: boolean): void => onDecide(approve, decision.length > 0 ? decision : undefined);
  return (
    <div className={styles.decisionForm}>
      <textarea
        className={styles.textarea}
        rows={2}
        value={decision}
        placeholder={t('catalog.admin.decisionPlaceholder')}
        onChange={(e) => setDecision(e.target.value)}
      />
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
