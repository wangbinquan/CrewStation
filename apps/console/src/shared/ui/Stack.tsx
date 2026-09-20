import type { ComponentPropsWithRef, ReactElement } from 'react';
import styles from './Stack.module.css';

/** 内容块之间的纵向间距；按钮保持自然宽度，表单、表格与提示仍占满可用宽度。 */
export function Stack({ className, ...props }: ComponentPropsWithRef<'div'>): ReactElement {
  return <div className={[styles.stack, className].filter(Boolean).join(' ')} {...props} />;
}
