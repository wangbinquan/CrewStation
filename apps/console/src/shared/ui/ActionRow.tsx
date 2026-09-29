import type { ComponentPropsWithRef, ReactElement } from 'react';
import styles from './ActionRow.module.css';

/** 同组操作横排并按可用宽度换行；与周围内容的间距由 Stack 或页面布局负责。 */
export function ActionRow({ className, align = 'center', ...props }: ComponentPropsWithRef<'div'> & { align?: 'center' | 'end' }): ReactElement {
  return <div className={[styles.actions, align === 'end' ? styles.end : undefined, className].filter(Boolean).join(' ')} {...props} />;
}
