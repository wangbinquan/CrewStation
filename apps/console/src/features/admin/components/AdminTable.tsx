import type { ReactElement, ReactNode } from 'react';
import styles from './AdminTable.module.css';

export interface AdminTableProps {
  /** 表头文案，顺序即列顺序；行由调用方渲染，单元格样式走表格的后代选择器。 */
  readonly columns: readonly string[];
  readonly children: ReactNode;
}

/** 管理页各分区共用的表格外壳：窄屏时只让表格自身横向滚动，不撑破页面。 */
export function AdminTable({ columns, children }: AdminTableProps): ReactElement {
  return (
    <div className={styles.scroll}>
      <table className={styles.table}>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column}>{column}</th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}
