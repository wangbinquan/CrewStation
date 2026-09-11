import type { ReactElement, ReactNode } from 'react';
import styles from './DataTable.module.css';

export interface DataTableProps {
  /** 表头文案，顺序即列顺序。 */
  readonly columns: readonly string[];
  /** 表体的 `<tr>`；单元格样式走表格的后代选择器，调用方只写内容。 */
  readonly children: ReactNode;
  /** 列多到压不住时给表格一个最小宽度，由调用方的 CSS module 提供。 */
  readonly className?: string;
}

/** 列表的统一外观：窄屏时表格自己横向滚动，页面主体不出现横向滚动条。 */
export function DataTable({ columns, children, className }: DataTableProps): ReactElement {
  return (
    <div className={styles.scroll}>
      <table className={[styles.table, className].filter(Boolean).join(' ')}>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column} scope="col">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}
