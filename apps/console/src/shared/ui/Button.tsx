import type { ComponentPropsWithRef, ReactElement } from 'react';
import styles from './Button.module.css';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost';
/** 表格行、卡片角、开发页工具行这类紧凑位置用 `small`。 */
export type ButtonSize = 'small';

export interface ButtonProps extends ComponentPropsWithRef<'button'> {
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
}

/** 按钮与按钮样式链接（`ButtonLink`）共用同一套外观。 */
export function buttonClassName(variant: ButtonVariant = 'secondary', size?: ButtonSize, className?: string): string {
  return [styles.button, styles[variant], size ? styles[size] : undefined, className].filter(Boolean).join(' ');
}

export function Button({ variant = 'secondary', size, type = 'button', className, ...rest }: ButtonProps): ReactElement {
  return <button type={type} className={buttonClassName(variant, size, className)} {...rest} />;
}
