import { useId, useLayoutEffect, useRef } from 'react';
import type { FormEvent, KeyboardEvent, MouseEvent, ReactElement, ReactNode, RefObject, SyntheticEvent } from 'react';
import { createPortal } from 'react-dom';
import { currentOpener, returnFocus } from '../../lib/focusReturn';
import { useT } from '../../lib/useT';
import { Button } from '../Button';
import { useDialogHost } from './DialogHost';
import styles from './Dialog.module.css';

/** 三档宽度：`small` 480（确认）、`medium` 600（一般表单，默认）、`large` 880（多页签、多步骤的大表单）。 */
export type DialogSize = 'small' | 'medium' | 'large';

export interface DialogProps {
  /** 动作名，作标题，如「进入维护」「修改 API_KEY」。 */
  readonly title: string;
  /** 正文；为 null 时不画正文（只有标题与操作条的简短确认）。 */
  readonly children: ReactNode;
  /** 底部操作条：靠左，主按钮在最左、取消用 ghost（按钮规范）。 */
  readonly footer?: ReactNode;
  /** ✕、Esc 与浏览器强行关闭都走这里；草稿怎么留由调用方决定。 */
  readonly onClose: () => void;
  /** 请求进行中：✕ 与 Esc 都不可用，结果由调用方在请求结束后处理。 */
  readonly busy?: boolean;
  readonly size?: DialogSize;
  /** 确认类弹窗用 `alertdialog`。 */
  readonly role?: 'dialog' | 'alertdialog';
  /** 问句等说明的元素 id。 */
  readonly describedBy?: string;
  /** 给了就把正文与操作条包成 `<form noValidate>`：回车与 type="submit" 的按钮都走这里。 */
  readonly onSubmit?: () => void;
  /**
   * 打开时聚焦哪里：传 useRef 的结果就聚焦那个控件；`dialog` 聚焦弹窗本身（确认类：读屏先读标题与问句，Tab 才到按钮，不会误按确认）；
   * 不给就聚焦正文里第一个可编辑控件，没有就聚焦弹窗本身。
   */
  readonly initialFocus?: RefObject<HTMLElement | null> | 'dialog';
}

/** 正文里可编辑的控件：打开弹窗、清空输入后焦点落在第一个上。 */
export const DIALOG_FIELD_SELECTOR = 'input:not([type="hidden"]):not(:disabled), select:not(:disabled), textarea:not(:disabled)';

const stop = (event: SyntheticEvent): void => event.stopPropagation();
/**
 * 弹窗经 portal 渲染，React 事件却仍沿组件树冒泡到打开它的组件：行的点击会选中行、外层表单的提交会被触发、
 * 拖动与焦点跟踪会把弹窗里的操作当成自己的。弹窗根上截住这些事件，外层只看得到自己 DOM 里发生的事。
 */
const ISOLATE = { onClick: stop, onDoubleClick: stop, onContextMenu: stop, onKeyUp: stop, onPointerDown: stop, onMouseDown: stop, onFocus: stop, onBlur: stop, onChange: stop, onInput: stop, onSubmit: stop } as const;

/**
 * 全站弹窗的底座：页面内的模态 `<dialog>`（`showModal`），不是浏览器原生 alert／confirm，不会冻住调试用的浏览器自动化。
 * 调用方挂载即打开、卸载即关闭；✕、Esc 关闭，点遮罩不关；打开时焦点进弹窗，关闭后回到打开它的控件；
 * 弹窗里的 Esc 不再冒泡到外层的键盘处理；浏览器强行关掉弹窗（连续 Esc 的防滥用规则）时按关闭处理，免得留下看不见的弹窗。
 */
export function Dialog({ title, children, footer, onClose, busy = false, size = 'medium', role = 'dialog', describedBy, onSubmit, initialFocus }: DialogProps): ReactElement {
  const t = useT(), titleId = useId(), host = useDialogHost();
  const dialog = useRef<HTMLDialogElement>(null), body = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const opener = currentOpener(), node = dialog.current;
    if (node && !node.open) node.showModal();
    const target = initialFocus === 'dialog' ? node : initialFocus?.current ?? body.current?.querySelector<HTMLElement>(DIALOG_FIELD_SELECTOR) ?? node;
    target?.focus();
    // 卸载时元素随之移出顶层，不调用 close()，免得卸载后再派发 close 事件。
    return () => returnFocus(opener);
  }, [initialFocus]);
  // Esc：浏览器先派发 cancel，拦下后由调用方决定关闭；进行中不关。
  const cancel = (event: SyntheticEvent): void => { event.preventDefault(); if (!busy) onClose(); };
  const keyDown = (event: KeyboardEvent): void => { event.stopPropagation(); };
  const submit = (event: FormEvent): void => { event.preventDefault(); event.stopPropagation(); if (!busy) onSubmit?.(); };
  const content = <>
    <header className={styles.header}>
      <h2 id={titleId} className={styles.title}>{title}</h2>
      <Button variant="ghost" size="small" className={styles.close} aria-label={t('ui.dialog.close')} title={t('ui.dialog.close')} disabled={busy} onClick={onClose}>✕</Button>
    </header>
    {children !== undefined && children !== null && children !== false ? <div ref={body} className={styles.body}>{children}</div> : null}
    {footer !== undefined && footer !== null && footer !== false ? <div className={styles.footer}>{footer}</div> : null}
  </>;
  const element = (
    <dialog ref={dialog} className={[styles.dialog, size === 'medium' ? undefined : styles[size]].filter(Boolean).join(' ')} role={role} aria-labelledby={titleId} aria-describedby={describedBy} aria-busy={busy} tabIndex={-1} data-cs-dialog=""
      {...ISOLATE} onKeyDown={keyDown} onCancel={cancel} onClose={onClose}>
      {onSubmit ? <form className={styles.frame} noValidate onSubmit={submit}>{content}</form> : <div className={styles.frame}>{content}</div>}
    </dialog>
  );
  return host ? createPortal(element, host) : element;
}

/**
 * 弹窗操作条最右的「清空」：回到打开时的初始值、弹窗不关（2026-09-23 裁定：关窗时草稿静默保留，要丢掉就点它）。
 * 清空后它随即不可点，焦点先交给第一个输入框，免得落到 body 上。
 */
export function DialogClearButton({ busy, dirty, onClear }: { readonly busy: boolean; readonly dirty: boolean; readonly onClear: () => void }): ReactElement {
  const t = useT();
  const clear = (event: MouseEvent<HTMLButtonElement>): void => {
    const field = event.currentTarget.closest('dialog')?.querySelector<HTMLElement>(DIALOG_FIELD_SELECTOR);
    onClear();
    field?.focus();
  };
  return <Button variant="ghost" className={styles.clear} disabled={busy || !dirty} onClick={clear}>{t('ui.dialog.clear')}</Button>;
}
