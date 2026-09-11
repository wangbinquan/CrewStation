import type { ReactElement, ReactNode } from 'react';
import { DataTable } from '../../../shared/ui/DataTable';
import styles from './CapabilityTable.module.css';

export interface TableColumn<T> {
  readonly header: string;
  readonly cell: (row: T) => ReactNode;
}

export interface CapabilityTableProps<T> {
  readonly columns: readonly TableColumn<T>[];
  readonly rows: readonly T[];
  readonly rowKey: (row: T) => string;
  readonly empty: string;
}

/** 能力页的通用只读表：各段只给列定义，表头与空态的表现因此完全一致；表格外观来自 shared 的 DataTable。 */
export function CapabilityTable<T>({ columns, rows, rowKey, empty }: CapabilityTableProps<T>): ReactElement {
  if (rows.length === 0) return <p className={styles.muted}>{empty}</p>;
  return (
    <DataTable columns={columns.map((column) => column.header)}>
      {rows.map((row) => (
        <tr key={rowKey(row)}>
          {columns.map((column) => (
            <td key={column.header}>{column.cell(row)}</td>
          ))}
        </tr>
      ))}
    </DataTable>
  );
}
