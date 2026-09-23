import { useId, useLayoutEffect, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent, ReactElement, ReactNode, SyntheticEvent } from 'react';
import { useT } from '../../lib/useT';
import { Button } from '../Button';
import { FormField } from '../FormField';
import styles from './ConfirmDialog.module.css';

/** 不可撤销动作要求输入的确认词：中英文界面一律输英文（2026-09-23 作者裁定）。 */
export type ConfirmWord = 'archive' | 'delete' | 'discard';

/** 输入与确认词一致：不分大小写，忽略首尾空格。 */
export function matchesConfirmWord(input: string, word: ConfirmWord): boolean {
  return input.trim().toLowerCase() === word;
}

export interface ConfirmDialogProps {
  /** 动作名，作弹窗标题，如「归档项目」。 */
  readonly title: string;
  /** 写清对象的问句，如「归档「演示数字人」（demo）？」。 */
  readonly question: string;
  /** 后果清单、检查结果与错误。 */
  readonly children?: ReactNode;
  readonly confirmWord: ConfirmWord;
  readonly confirmLabel: string;
  /** 不给就用通用的 ui.confirm.no。 */
  readonly cancelLabel?: string;
  /** 请求进行中：确认键显示 busyLabel，输入、确认、取消与 Esc 都不可用。 */
  readonly busy?: boolean;
  readonly busyLabel?: string;
  /** 输入正确之外的阻断，如预检尚未完成或已失效。 */
  readonly confirmDisabled?: boolean;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}

/**
 * 不可撤销动作（归档、删除、丢弃未提交内容）的确认弹窗：页面内的模态 `<dialog>`，写清对象与后果，
 * 输入英文确认词后确认键才可用，防止点错。它不是浏览器原生 alert／confirm，不会冻住调试用的浏览器自动化。
 * 调用方挂载即打开、卸载即关闭；Esc 与「取消」关闭，点遮罩不关。打开时焦点进输入框，关闭后回到打开它的控件。
 */
export function ConfirmDialog({ title, question, children, confirmWord, confirmLabel, cancelLabel, busy = false, busyLabel, confirmDisabled = false, onConfirm, onCancel }: ConfirmDialogProps): ReactElement {
  const t = useT(), titleId = useId(), questionId = useId();
  const dialog = useRef<HTMLDialogElement>(null), input = useRef<HTMLInputElement>(null);
  const [typed, setTyped] = useState('');
  const ready = matchesConfirmWord(typed, confirmWord) && !busy && !confirmDisabled;
  useLayoutEffect(() => {
    const opener = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
    if (dialog.current && !dialog.current.open) dialog.current.showModal();
    input.current?.focus();
    // 卸载时元素随之移出顶层，不调用 close()，免得卸载后再派发 close 事件。
    return () => restoreFocus(opener);
  }, []);
  const submit = (event: FormEvent): void => { event.preventDefault(); if (ready) onConfirm(); };
  // Esc：浏览器先派发 cancel，拦下后由调用方决定关闭；进行中不关。
  const cancel = (event: SyntheticEvent): void => { event.preventDefault(); if (!busy) onCancel(); };
  // 弹窗里的 Esc 不再冒泡到外层的键盘处理（如操作面板按 Esc 收起）。
  const keyDown = (event: KeyboardEvent): void => { if (event.key === 'Escape') event.stopPropagation(); };
  return (
    // 浏览器仍可能强行关掉弹窗（连续 Esc 时的防滥用规则），这时按取消处理，免得界面留着一个看不见的弹窗。
    <dialog ref={dialog} className={styles.dialog} role="alertdialog" aria-labelledby={titleId} aria-describedby={questionId} aria-busy={busy} onCancel={cancel} onClose={onCancel} onKeyDown={keyDown}>
      <form className={styles.form} onSubmit={submit}>
        <h2 id={titleId} className={styles.title}>{title}</h2>
        <p id={questionId} className={styles.question}>{question}</p>
        {children !== undefined ? <div className={styles.body}>{children}</div> : null}
        <FormField label={t('ui.dialog.typeToConfirm', { word: confirmWord })}>
          <input ref={input} value={typed} disabled={busy} autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} onChange={(event) => setTyped(event.target.value)} />
        </FormField>
        <div className={styles.actions}>
          <Button type="submit" variant="dangerPrimary" disabled={!ready}>{busy ? (busyLabel ?? confirmLabel) : confirmLabel}</Button>
          <Button variant="ghost" disabled={busy} onClick={onCancel}>{cancelLabel ?? t('ui.confirm.no')}</Button>
        </div>
      </form>
    </dialog>
  );
}

function restoreFocus(target: HTMLElement | null): void {
  if (!target?.isConnected) return;
  target.focus();
  // 关闭的同一次提交里打开它的按钮可能仍带着 disabled；下一个宏任务再试一次。
  if (document.activeElement !== target) setTimeout(() => { if (target.isConnected && document.activeElement === document.body) target.focus(); }, 0);
}
