import { useId, useRef, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { useT } from '../../lib/useT';
import { ActionRow } from '../ActionRow';
import { Button } from '../Button';
import { FormField } from '../FormField';
import { Dialog } from './Dialog';
import styles from './Dialog.module.css';

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
  /** 请求进行中：确认键显示 busyLabel，输入、确认、取消、✕ 与 Esc 都不可用。 */
  readonly busy?: boolean;
  readonly busyLabel?: string;
  /** 输入正确之外的阻断，如预检尚未完成或已失效。 */
  readonly confirmDisabled?: boolean;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}

/**
 * 不可撤销动作（归档、删除、丢弃未提交内容）的确认弹窗：搭在全站弹窗底座 Dialog 上，写清对象与后果，
 * 输入英文确认词后确认键才可用，防止点错。打开时焦点进输入框；取消、✕ 与 Esc 关闭，点遮罩不关。
 */
export function ConfirmDialog({ title, question, children, confirmWord, confirmLabel, cancelLabel, busy = false, busyLabel, confirmDisabled = false, onConfirm, onCancel }: ConfirmDialogProps): ReactElement {
  const t = useT(), questionId = useId(), input = useRef<HTMLInputElement>(null);
  const [typed, setTyped] = useState('');
  const ready = matchesConfirmWord(typed, confirmWord) && !busy && !confirmDisabled;
  const footer = <ActionRow>
    <Button type="submit" variant="dangerPrimary" disabled={!ready}>{busy ? (busyLabel ?? confirmLabel) : confirmLabel}</Button>
    <Button variant="ghost" disabled={busy} onClick={onCancel}>{cancelLabel ?? t('ui.confirm.no')}</Button>
  </ActionRow>;
  return <Dialog title={title} size="small" role="alertdialog" describedBy={questionId} busy={busy} initialFocus={input} footer={footer} onClose={onCancel} onSubmit={() => { if (ready) onConfirm(); }}>
    <p id={questionId} className={styles.question}>{question}</p>
    {children !== undefined ? <div className={styles.consequences}>{children}</div> : null}
    <FormField label={t('ui.dialog.typeToConfirm', { word: confirmWord })}>
      <input ref={input} value={typed} disabled={busy} autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} onChange={(event) => setTyped(event.target.value)} />
    </FormField>
  </Dialog>;
}
