import type { ReactElement } from 'react';
import { Button } from '../../../shared/ui/Button';
import styles from './ConfirmPanel.module.css';

export interface ConfirmPanelProps {
  readonly question: string;
  readonly hint?: string;
  readonly confirmLabel: string;
  readonly cancelLabel: string;
  readonly busy?: boolean;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}

/**
 * 面板内的确认块：是否展开由调用方决定，因此问句、确认与取消都由外部驱动。
 * 与 shared 的 InlineConfirm 不同——那个自己管两段式状态，这个是受控的一整块。
 * 平台工作台一律不用 window.confirm：它会冻结页面，调试用的浏览器自动化也会被卡住。
 */
export function ConfirmPanel({ question, hint, confirmLabel, cancelLabel, busy = false, onConfirm, onCancel }: ConfirmPanelProps): ReactElement {
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
