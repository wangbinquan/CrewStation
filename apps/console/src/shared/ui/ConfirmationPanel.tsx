import { useEffect, useRef } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { currentOpener, returnFocus } from '../lib/focusReturn';
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
  /** 不可撤销的动作：确认键红底白字。 */
  readonly danger?: boolean;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}

/**
 * 页内确认面板：先展示对象与检查材料，再由用户确认。2026-09-23 起页内展开的确认一律改弹窗（`dialog/ConfirmationDialog`），
 * 这里只留给作者裁定仍在页内的确认（工作区干净时释放开发会话）。
 * 打开时把焦点移到面板本身（读屏先读到问题，Tab 才到按钮，不会误按确认），关闭时焦点回到打开它的控件（RFC-003 UX-AT-26）。
 */
export function ConfirmationPanel({ question, hint, children, confirmLabel, cancelLabel, busy = false, confirmDisabled = false, danger = false, onConfirm, onCancel }: ConfirmationPanelProps): ReactElement {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const opener = currentOpener();
    // 调用方已把焦点放进面板时尊重它，否则焦点落在面板本身。
    if (!root.current?.contains(document.activeElement)) root.current?.focus();
    return () => returnFocus(opener);
  }, []);
  return (
    <div className={styles.confirm} role="alertdialog" aria-label={question} aria-busy={busy} tabIndex={-1} ref={root}>
      <p className={styles.question}>{question}</p>
      {hint !== undefined ? <p className={styles.hint}>{hint}</p> : null}
      {children}
      <div className={styles.actions}>
        <Button variant={danger ? 'dangerPrimary' : 'primary'} onClick={onConfirm} disabled={busy || confirmDisabled}>{confirmLabel}</Button>
        <Button variant="ghost" onClick={onCancel} disabled={busy}>{cancelLabel}</Button>
      </div>
    </div>
  );
}
