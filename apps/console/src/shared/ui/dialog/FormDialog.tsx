import type { ReactElement, ReactNode, RefObject } from 'react';
import { useT } from '../../lib/useT';
import { ActionNote } from '../ActionNote';
import { ActionRow } from '../ActionRow';
import { Button } from '../Button';
import { Dialog, DialogClearButton } from './Dialog';
import type { DialogSize } from './Dialog';

export interface FormDialogProps {
  readonly title: string;
  /** 表单字段；提交按钮与取消在弹窗底部，调用方不再自己画。 */
  readonly children: ReactNode;
  readonly submitLabel: string;
  /** 进行中提交按钮上的文案；不给就沿用 submitLabel。 */
  readonly busyLabel?: string;
  readonly busy?: boolean;
  readonly submitDisabled?: boolean;
  /** 不可撤销的提交：红底白字。 */
  readonly danger?: boolean;
  /** 保存失败等说明：显示在操作条上方，不随正文滚走。 */
  readonly error?: ReactNode;
  readonly onSubmit: () => void;
  /** ✕、取消与 Esc：只关窗，草稿由调用方留着（2026-09-23 裁定：再打开恢复上次输入，离开页面才丢）。 */
  readonly onClose: () => void;
  /** 回到打开时的初始值、弹窗不关；给了就在操作条最右显示「清空」。 */
  readonly onClear?: () => void;
  /** 输入与初始值不同：「清空」只在这时可点。 */
  readonly dirty?: boolean;
  /** 取消的文案；不给就用通用的 ui.confirm.no。 */
  readonly cancelLabel?: string;
  /** 取消之后的其他按钮，如编辑时的「删除」。 */
  readonly actions?: ReactNode;
  readonly size?: DialogSize;
  readonly initialFocus?: RefObject<HTMLElement | null>;
}

/**
 * 表单弹窗：在 Dialog 上加一个 `<form noValidate>`，底部是「提交（主按钮，最左）｜取消｜……｜清空（最右）」。
 * 校验与提交由调用方做，失败时保留输入、把原因交给 `error`。
 */
export function FormDialog({ title, children, submitLabel, busyLabel, busy = false, submitDisabled = false, danger = false, error, onSubmit, onClose, onClear, dirty = false, cancelLabel, actions, size, initialFocus }: FormDialogProps): ReactElement {
  const t = useT();
  const footer = <>
    {error !== undefined && error !== null && error !== false && error !== '' ? <ActionNote tone="error">{error}</ActionNote> : null}
    <ActionRow>
      <Button type="submit" variant={danger ? 'dangerPrimary' : 'primary'} disabled={busy || submitDisabled}>{busy ? (busyLabel ?? submitLabel) : submitLabel}</Button>
      <Button variant="ghost" disabled={busy} onClick={onClose}>{cancelLabel ?? t('ui.confirm.no')}</Button>
      {actions}
      {onClear ? <DialogClearButton busy={busy} dirty={dirty} onClear={onClear} /> : null}
    </ActionRow>
  </>;
  // 提交键不可用时回车与 requestSubmit 也不提交。
  return <Dialog title={title} size={size} busy={busy} onClose={onClose} onSubmit={() => { if (!submitDisabled) onSubmit(); }} footer={footer} {...(initialFocus ? { initialFocus } : {})}>{children}</Dialog>;
}
