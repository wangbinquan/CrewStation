import type { ApiOperationDto } from '@crewstation/contracts';
import type { ReactElement, ReactNode } from 'react';
import { useT } from '../../../shared/lib/useT';
import { Badge } from '../../../shared/ui/Badge';
import { DataTable } from '../../../shared/ui/DataTable';
import styles from './OperationsPanel.module.css';

export interface OperationsTableProps {
  readonly operations: readonly ApiOperationDto[];
  readonly serviceContext?: boolean;
  readonly renderActions: (operation: ApiOperationDto) => ReactNode;
}

/** 操作表：键、代理、方法、路径、开放策略、本服务是否已可调。 */
export function OperationsTable({ operations, serviceContext = true, renderActions }: OperationsTableProps): ReactElement {
  const t = useT();
  const columns = [
    t('catalog.operations.key'), t('catalog.operations.proxy'), t('catalog.operations.method'), t('catalog.operations.path'),
    t('catalog.operations.policy'), ...(serviceContext ? [t('catalog.operations.granted')] : []), t('catalog.operations.actions'),
  ];
  return (
    <DataTable columns={columns} className={styles.operationsTable}>
      {operations.map((operation) => (
        <tr key={operation.key}>
          <td>
            <code>{operation.key}</code>
            {operation.summary !== undefined ? <p className={styles.summary}>{operation.summary}</p> : null}
          </td>
          <td className={styles.proxyCell}>{operation.proxy}</td>
          <td className={styles.methodCell}>
            <code>{operation.method}</code>
          </td>
          <td className={styles.pathCell}>
            <code>{operation.path}</code>
          </td>
          <td>
            <Badge tone={operation.openPolicy === 'default' ? 'success' : 'warning'}>{t(`catalog.policy.${operation.openPolicy}`)}</Badge>
          </td>
          {serviceContext ? <td>
            <Badge tone={operation.granted === true ? 'success' : 'neutral'}>{operation.granted === true ? t('catalog.granted.yes') : t('catalog.granted.no')}</Badge>
          </td> : null}
          <td className={styles.actionsCell}>
            {renderActions(operation)}
          </td>
        </tr>
      ))}
    </DataTable>
  );
}
