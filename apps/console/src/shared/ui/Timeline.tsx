import type { ReactElement, ReactNode } from 'react';
import type { BadgeTone } from './Badge';
import styles from './Timeline.module.css';

export interface TimelineItem {
  readonly id: string;
  readonly tone: BadgeTone;
  /** 圆点是一次发布，方块是一次上线／回退；形状与颜色一起区分，不只靠颜色。 */
  readonly shape?: 'dot' | 'square';
  readonly primary: ReactNode;
  readonly secondary?: ReactNode;
  readonly time: string;
  readonly action?: ReactNode;
}

/** 按时间排列的记录列表：概览的最近动态与发布页的发布记录共用。 */
export function Timeline({ items, label }: { readonly items: readonly TimelineItem[]; readonly label: string }): ReactElement {
  return <ul className={styles.list} aria-label={label}>
    {items.map((item) => <li key={item.id} className={styles.item}>
      <span className={[styles.mark, styles[item.tone], item.shape === 'square' ? styles.square : ''].filter(Boolean).join(' ')} aria-hidden="true" />
      <span className={styles.text}><span className={styles.primary}>{item.primary}</span>{item.secondary !== undefined ? <span className={styles.secondary}>{item.secondary}</span> : null}</span>
      <span className={styles.side}>{item.action}<time className={styles.time}>{item.time}</time></span>
    </li>)}
  </ul>;
}
