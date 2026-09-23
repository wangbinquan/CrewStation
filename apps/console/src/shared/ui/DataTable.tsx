import type { ReactElement, ReactNode } from 'react';
import styles from './DataTable.module.css';

export interface DataTableProps {
  /** 表头文案，顺序即列顺序。 */
  readonly columns: readonly string[];
  /** 表体的 `<tr>`；单元格样式走表格的后代选择器，调用方只写内容。 */
  readonly children: ReactNode;
  /** 列多到压不住时给表格一个最小宽度，由调用方的 CSS module 提供。 */
  readonly className?: string;
  /**
   * 表头停在外层滚动区的顶部：表格自己不再成为滚动区（否则表头只对它自己吸顶），横向与纵向滚动都交给调用方
   * 包在外面的滚动区（集群管理资源清单的表格区，2026-09-23）。外面没有滚动区时不要用，宽表会撑出页面。
   */
  readonly stickyHeader?: boolean;
}

/** 列表的统一外观：窄屏时表格自己横向滚动，页面主体不出现横向滚动条。 */
export function DataTable({ columns, children, className, stickyHeader = false }: DataTableProps): ReactElement {
  return (
    <div className={stickyHeader ? styles.sticky : styles.scroll}>
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
