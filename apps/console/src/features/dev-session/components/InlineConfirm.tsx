import type { ReactElement } from 'react';
import { Button } from '../../../shared/ui/Button';
import styles from './InlineConfirm.module.css';

export interface InlineConfirmProps {
  readonly question: string;
  readonly hint?: string;
  readonly confirmLabel: string;
  readonly cancelLabel: string;
  readonly busy?: boolean;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}

/**
 * 就地确认。
 * 平台工作台一律不用 window.confirm：它会冻结页面，调试用的浏览器自动化也会被卡住。
 */
export function InlineConfirm({ question, hint, confirmLabel, cancelLabel, busy = false, onConfirm, onCancel }: InlineConfirmProps): ReactElement {
  return (
    <div className={styles.confirm} role="alertdialog" aria-label={question}>
      <p className={styles.question}>{question}</p>
      {hint !== undefined ? <p className={styles.hint}>{hint}</p> : null}
      <div className={styles.actions}>
        <Button variant="primary" onClick={onConfirm} disabled={busy}>
          {confirmLabel}
        </Button>
        <Button onClick={onCancel} disabled={busy}>
          {cancelLabel}
        </Button>
      </div>
    </div>
  );
}
