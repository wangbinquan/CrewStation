import type { ReactElement, ReactNode } from 'react';
import styles from './Badge.module.css';

export type BadgeTone = 'neutral' | 'info' | 'success' | 'warning';

export interface BadgeProps {
  readonly tone?: BadgeTone;
  readonly children: ReactNode;
}

export function Badge({ tone = 'neutral', children }: BadgeProps): ReactElement {
  return <span className={[styles.badge, styles[tone]].join(' ')}>{children}</span>;
}
