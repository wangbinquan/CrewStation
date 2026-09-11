import type { ApiOperationDto, ApiRequestDto } from '@crewstation/contracts';
import type { ReactElement } from 'react';
import { useT } from '../../../shared/lib/useT';
import { Badge } from '../../../shared/ui/Badge';
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
  return (
    <div className={styles.tableWrapper}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>{t('catalog.operations.key')}</th>
            <th>{t('catalog.operations.proxy')}</th>
            <th>{t('catalog.operations.method')}</th>
            <th>{t('catalog.operations.path')}</th>
            <th>{t('catalog.operations.policy')}</th>
            <th>{t('catalog.operations.granted')}</th>
            <th>{t('catalog.operations.actions')}</th>
          </tr>
        </thead>
        <tbody>
          {operations.map((operation) => (
            <tr key={operation.key}>
              <td>
                <code className={styles.key}>{operation.key}</code>
                {operation.summary !== undefined ? <p className={styles.summary}>{operation.summary}</p> : null}
              </td>
              <td>{operation.proxy}</td>
              <td>
                <code>{operation.method}</code>
              </td>
              <td>
                <code className={styles.path}>{operation.path}</code>
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
        </tbody>
      </table>
    </div>
  );
}
