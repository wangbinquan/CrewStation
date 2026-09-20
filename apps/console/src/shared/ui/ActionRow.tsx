import type { ComponentPropsWithRef, ReactElement } from 'react';
import styles from './ActionRow.module.css';

/** 同组操作横排并按可用宽度换行；与周围内容的间距由 Stack 或页面布局负责。 */
export function ActionRow({ className, ...props }: ComponentPropsWithRef<'div'>): ReactElement {
  return <div className={[styles.actions, className].filter(Boolean).join(' ')} {...props} />;
}
