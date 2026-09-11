import type { ReactElement, ReactNode } from 'react';
import styles from './DetailList.module.css';

export interface DetailItem {
  readonly label: string;
  readonly value: ReactNode;
}

/** 标签／取值两列；会话摘要、预览状态、绑定详情共用一种排版。 */
export function DetailList({ items }: { readonly items: readonly DetailItem[] }): ReactElement {
  return (
    <dl className={styles.list}>
      {items.map((item) => (
        <div key={item.label} className={styles.row}>
          <dt className={styles.label}>{item.label}</dt>
          <dd className={styles.value}>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
