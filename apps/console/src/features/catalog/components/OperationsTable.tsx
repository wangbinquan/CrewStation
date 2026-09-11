import type { ApiOperationDto, ApiRequestDto } from '@crewstation/contracts';
import type { ReactElement } from 'react';
import { useT } from '../../../shared/lib/useT';
import { Badge } from '../../../shared/ui/Badge';
import { DataTable } from '../../../shared/ui/DataTable';
import type { CatalogActions } from '../hooks/useCatalogActions';
import { OperationActions } from './OperationActions';
import styles from './OperationsPanel.module.css';

export interface OperationsTableProps {
  readonly operations: readonly ApiOperationDto[];
  /** 按操作键索引的未决申请，行内据此显示“待审批”。 */
  readonly pendingByKey: ReadonlyMap<string, ApiRequestDto>;
  readonly isAdmin: boolean;
  readonly actions: CatalogActions;
}

/** 操作表：键、代理、方法、路径、开放策略、本服务是否已可调。 */
export function OperationsTable({ operations, pendingByKey, isAdmin, actions }: OperationsTableProps): ReactElement {
  const t = useT();
  const columns = [
    t('catalog.operations.key'), t('catalog.operations.proxy'), t('catalog.operations.method'), t('catalog.operations.path'),
    t('catalog.operations.policy'), t('catalog.operations.granted'), t('catalog.operations.actions'),
  ];
  return (
    <DataTable columns={columns}>
      {operations.map((operation) => (
        <tr key={operation.key}>
          <td>
            <code>{operation.key}</code>
            {operation.summary !== undefined ? <p className={styles.summary}>{operation.summary}</p> : null}
          </td>
          <td>{operation.proxy}</td>
          <td>
            <code>{operation.method}</code>
          </td>
          <td>
            <code>{operation.path}</code>
          </td>
          <td>
            <Badge tone={operation.openPolicy === 'default' ? 'success' : 'warning'}>{t(`catalog.policy.${operation.openPolicy}`)}</Badge>
          </td>
          <td>
            <Badge tone={operation.granted === true ? 'success' : 'neutral'}>{operation.granted === true ? t('catalog.granted.yes') : t('catalog.granted.no')}</Badge>
          </td>
          <td>
            <OperationActions operation={operation} pendingRequest={pendingByKey.get(operation.key)} isAdmin={isAdmin} actions={actions} />
          </td>
        </tr>
      ))}
    </DataTable>
  );
}
