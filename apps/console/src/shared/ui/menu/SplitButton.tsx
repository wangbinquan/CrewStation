import type { ReactElement, ReactNode } from 'react';
import { Button } from '../Button';
import type { ButtonProps } from '../Button';
import styles from './SplitButton.module.css';

export interface SplitButtonProps extends Omit<ButtonProps, 'children'> {
  readonly label: ReactNode;
  /** 展开部分的可读名称（读屏与 title）。 */
  readonly menuLabel: string;
  /** 展开后显示的选项；用 details/summary 承载，没有额外的浮层机制。 */
  readonly menu: ReactNode;
  readonly menuDisabled?: boolean;
}

/** 主键＋展开：主键按记住的选项直接执行，箭头展开可换选项（RFC-020 §4.3 的「＋ CLI ▾」）。 */
export function SplitButton({ label, menuLabel, menu, menuDisabled = false, variant = 'primary', className, ...rest }: SplitButtonProps): ReactElement {
  return <span className={[styles.split, className].filter(Boolean).join(' ')}>
    <Button variant={variant} className={styles.main} {...rest}>{label}</Button>
    <details className={styles.menu}>
      <summary className={[styles.caret, styles[variant], menuDisabled ? styles.caretDisabled : ''].filter(Boolean).join(' ')} title={menuLabel} aria-label={menuLabel} aria-disabled={menuDisabled}>▾</summary>
      <div className={styles.body}>{menu}</div>
    </details>
  </span>;
}
