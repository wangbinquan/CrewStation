import type { ReactElement, ReactNode } from 'react';
import styles from './DefinitionList.module.css';

export interface DefinitionItem {
  readonly label: string;
  readonly value: ReactNode;
}

export interface DefinitionListProps {
  readonly items: readonly DefinitionItem[];
  /** stacked：一行一对，窄卡片用；grid：按可用宽度自动分栏，宽面板用。 */
  readonly layout?: 'stacked' | 'grid';
}

/** 名值对列表：卡片摘要、部署槽、会话详情共用同一种两栏排版。 */
export function DefinitionList({ items, layout = 'stacked' }: DefinitionListProps): ReactElement {
  return (
    <dl className={[styles.list, styles[layout]].join(' ')}>
      {items.map((item) => (
        <div key={item.label} className={styles.row}>
          <dt className={styles.label}>{item.label}</dt>
          <dd className={styles.value}>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
