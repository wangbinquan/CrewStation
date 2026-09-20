import type { ReactElement, ReactNode } from 'react';
import styles from './PaneNotice.module.css';

export type NoticeTone = 'info' | 'warning' | 'muted';

export interface PaneNoticeProps {
  readonly tone?: NoticeTone;
  readonly children: ReactNode;
}

/** 面板内的一行提示；warning 用 role=alert，读屏能播报失败。 */
export function PaneNotice({ tone = 'info', children }: PaneNoticeProps): ReactElement {
  return (
    <div className={[styles.notice, styles[tone]].join(' ')} role={tone === 'warning' ? 'alert' : 'status'}>
      {children}
    </div>
  );
}
