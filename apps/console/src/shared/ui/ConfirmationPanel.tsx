import { useEffect, useRef } from 'react';
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

/** 最近一次获得焦点的控件：打开面板的按钮常在异步预检期间被禁用而失去焦点，此时 document.activeElement 已是 body。 */
let lastFocused: HTMLElement | null = null;
if (typeof document !== 'undefined') {
  const remember = (event: Event) => { if (event.target instanceof HTMLElement) lastFocused = event.target; };
  document.addEventListener('focusin', remember, true);
  document.addEventListener('focus', remember, true);
}

function restoreFocus(target: HTMLElement | null): void {
  if (!target?.isConnected) return;
  target.focus();
  // 关闭面板的同一次提交里，打开按钮可能仍带着 disabled；下一个宏任务再试一次。
  if (document.activeElement !== target) setTimeout(() => { if (target.isConnected && document.activeElement === document.body) target.focus(); }, 0);
}

/**
 * 受控确认面板：先展示对象与检查材料，再由用户确认；用于需要异步预检的动作。
 * 打开时把焦点移到面板本身（读屏先读到问题，Tab 才到按钮，不会误按确认），关闭时焦点回到打开它的控件（RFC-003 UX-AT-26）。
 */
export function ConfirmationPanel({ question, hint, children, confirmLabel, cancelLabel, busy = false, confirmDisabled = false, onConfirm, onCancel }: ConfirmationPanelProps): ReactElement {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const active = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
    const opener = active ?? lastFocused;
    // 调用方已把焦点放进面板（如编辑器放弃提示默认聚焦“继续编辑”）时尊重它，否则焦点落在面板本身。
    if (!root.current?.contains(document.activeElement)) root.current?.focus();
    return () => restoreFocus(opener);
  }, []);
  return (
    <div className={styles.confirm} role="alertdialog" aria-label={question} aria-busy={busy} tabIndex={-1} ref={root}>
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
