import type { ReactElement, ReactNode } from 'react';
import styles from './DataTable.module.css';

export interface DataTableProps {
  readonly headers: readonly string[];
  readonly children: ReactNode;
}

/** 列表的统一外观：窄屏时表格自己横向滚动，页面主体不出现横向滚动条。 */
export function DataTable({ headers, children }: DataTableProps): ReactElement {
  return (
    <div className={styles.scroll}>
      <table className={styles.table}>
        <thead>
          <tr>
            {headers.map((header) => (
              <th key={header} scope="col">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}
