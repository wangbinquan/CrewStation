import { useState } from 'react';
import type { ReactElement } from 'react';
import { useT } from '../lib/useT';
import { Button } from './Button';
import type { ButtonSize, ButtonVariant } from './Button';
import styles from './InlineConfirm.module.css';

export interface InlineConfirmProps {
  /** 触发按钮的文案。 */
  readonly label: string;
  /** 展开后的问句，说清这一下会改什么。 */
  readonly question: string;
  /** 触发按钮的样式：不可撤销的动作（下线、移除、删除…）用 `danger`，确认键随之是红底；其余用默认描边或 `primary`。 */
  readonly variant?: ButtonVariant;
  /** 表格行、时间线行里用紧凑尺寸；展开后的确认与取消跟着同一档。 */
  readonly size?: ButtonSize;
  /** 确认按钮的文案；不给就用通用的 ui.confirm.yes。 */
  readonly confirmLabel?: string;
  readonly busy?: boolean;
  /** 执行中触发按钮显示的文案；不给就沿用 label。 */
  readonly busyLabel?: string;
  readonly onConfirm: () => void;
}

/**
 * 两段式确认：先点一次展开问句，再点确认才执行；确认后立刻收起，进行中的反馈落在触发按钮上。
 * 一律不用 window.confirm——原生弹窗会冻结页面，也会卡住调试工作台用的浏览器自动化。
 */
export function InlineConfirm({ label, question, variant = 'secondary', size, confirmLabel, busy = false, busyLabel, onConfirm }: InlineConfirmProps): ReactElement {
  const t = useT();
  const [armed, setArmed] = useState(false);
  if (!armed) {
    return (
      <Button variant={variant} size={size} disabled={busy} onClick={() => setArmed(true)}>
        {busy ? (busyLabel ?? label) : label}
      </Button>
    );
  }
  return (
    <span className={styles.confirm} role="group">
      <span className={styles.question}>{question}</span>
      <Button
        variant={variant === 'danger' || variant === 'dangerPrimary' ? 'dangerPrimary' : 'primary'}
        size={size}
        disabled={busy}
        onClick={() => {
          setArmed(false);
          onConfirm();
        }}
      >
        {confirmLabel ?? t('ui.confirm.yes')}
      </Button>
      <Button variant="ghost" size={size} disabled={busy} onClick={() => setArmed(false)}>
        {t('ui.confirm.no')}
      </Button>
    </span>
  );
}
