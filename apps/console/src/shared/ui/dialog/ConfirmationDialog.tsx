import { useId, useRef } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { useT } from '../../lib/useT';
import { ActionRow } from '../ActionRow';
import { Button } from '../Button';
import { Dialog, DialogClearButton } from './Dialog';
import type { DialogSize } from './Dialog';
import styles from './Dialog.module.css';

export interface ConfirmationDialogProps {
  /** 动作名，如「上线 v1.3.0」；不给就用问句作标题。 */
  readonly title?: string;
  /** 写清对象与变化的问句。 */
  readonly question: string;
  readonly hint?: string;
  /** 核对材料：事实清单、影响范围、差异表，以及确认时一并提交的输入（如切换说明）。 */
  readonly children?: ReactNode;
  readonly confirmLabel: string;
  /** 不给就用通用的 ui.confirm.no。 */
  readonly cancelLabel?: string;
  readonly busy?: boolean;
  /** 进行中确认键上的文案；不给就沿用 confirmLabel。 */
  readonly busyLabel?: string;
  /** 核对失效、权限不足等阻断。 */
  readonly confirmDisabled?: boolean;
  /** 不可撤销的动作：确认键红底白字。 */
  readonly danger?: boolean;
  readonly onConfirm: () => void;
  /** 取消、✕ 与 Esc。 */
  readonly onCancel: () => void;
  /** 打开时聚焦：默认弹窗本身（读屏先读问句，Tab 才到按钮，不会误按确认）；`cancel` 聚焦取消键（如离开确认默认留在页面上）。 */
  readonly focus?: 'dialog' | 'cancel';
  /** 取消之后的其他按钮，如「重新核对」。 */
  readonly actions?: ReactNode;
  /** 核对材料里有输入（切换说明、审批意见）时：回到初始值、弹窗不关；给了就在操作条最右显示「清空」。 */
  readonly onClear?: () => void;
  /** 输入与初始值不同：「清空」只在这时可点。 */
  readonly dirty?: boolean;
  readonly size?: DialogSize;
}

/**
 * 确认弹窗：先展示对象与核对材料，再由用户确认。用于页内展开的确认面板改弹窗之后（2026-09-23 裁定）的全部确认，
 * 包括需要异步预检的动作与「放弃未保存输入／离开页面」一类提示；一行式的 InlineConfirm 仍在行内。
 * 不可撤销、要输入确认词的动作用 ConfirmDialog。
 */
export function ConfirmationDialog({ title, question, hint, children, confirmLabel, cancelLabel, busy = false, busyLabel, confirmDisabled = false, danger = false, onConfirm, onCancel, focus = 'dialog', actions, onClear, dirty = false, size = 'small' }: ConfirmationDialogProps): ReactElement {
  const t = useT(), questionId = useId(), hintId = useId(), cancelButton = useRef<HTMLButtonElement>(null);
  const footer = <ActionRow>
    <Button variant={danger ? 'dangerPrimary' : 'primary'} disabled={busy || confirmDisabled} onClick={onConfirm}>{busy ? (busyLabel ?? confirmLabel) : confirmLabel}</Button>
    <Button ref={cancelButton} variant="ghost" disabled={busy} onClick={onCancel}>{cancelLabel ?? t('ui.confirm.no')}</Button>
    {actions}
    {onClear ? <DialogClearButton busy={busy} dirty={dirty} onClear={onClear} /> : null}
  </ActionRow>;
  const describedBy = title !== undefined ? questionId : hint !== undefined ? hintId : undefined;
  // 没有标题时问句就是标题；问句、说明与核对材料都没有时不画正文，免得标题与按钮之间空出一截。
  const empty = title === undefined && hint === undefined && (children === undefined || children === null || children === false);
  return <Dialog title={title ?? question} role="alertdialog" size={size} busy={busy} onClose={onCancel} footer={footer} initialFocus={focus === 'cancel' ? cancelButton : 'dialog'} {...(describedBy ? { describedBy } : {})}>
    {empty ? null : <>
      {title !== undefined ? <p id={questionId} className={styles.question}>{question}</p> : null}
      {hint !== undefined ? <p id={hintId} className={styles.hint}>{hint}</p> : null}
      {children}
    </>}
  </Dialog>;
}
