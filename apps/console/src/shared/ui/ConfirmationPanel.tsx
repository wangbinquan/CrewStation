import type { ReactElement, ReactNode } from 'react';
import { Button } from './Button';
import styles from './ConfirmationPanel.module.css';

export interface ConfirmationPanelProps {
  readonly question: string;
  readonly hint?: string;
  readonly children?: ReactNode;
  readonly confirmLabel: string;
  readonly cancelLabel: string;
  readonly busy?: boolean;
  readonly confirmDisabled?: boolean;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}

/** 受控确认面板：先展示对象与检查材料，再由用户确认；用于需要异步预检的动作。 */
export function ConfirmationPanel({ question, hint, children, confirmLabel, cancelLabel, busy = false, confirmDisabled = false, onConfirm, onCancel }: ConfirmationPanelProps): ReactElement {
  return (
    <div className={styles.confirm} role="alertdialog" aria-label={question} aria-busy={busy}>
      <p className={styles.question}>{question}</p>
      {hint !== undefined ? <p className={styles.hint}>{hint}</p> : null}
      {children}
      <div className={styles.actions}>
        <Button variant="primary" onClick={onConfirm} disabled={busy || confirmDisabled}>{confirmLabel}</Button>
        <Button onClick={onCancel} disabled={busy}>{cancelLabel}</Button>
      </div>
    </div>
  );
}
