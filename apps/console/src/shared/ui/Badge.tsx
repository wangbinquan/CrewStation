import type { ReactElement, ReactNode } from 'react';
import styles from './Badge.module.css';

/** warning 是“还能用但要留意”，danger 是“已经坏了”；两者必须靠颜色区分，不能只靠文案。 */
export type BadgeTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

export interface BadgeProps {
  readonly tone?: BadgeTone;
  readonly children: ReactNode;
}

export function Badge({ tone = 'neutral', children }: BadgeProps): ReactElement {
  return <span className={[styles.badge, styles[tone]].join(' ')}>{children}</span>;
}
