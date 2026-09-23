import type { ApiOperationDto, ApiRequestDto } from '@crewstation/contracts';
import type { ReactElement } from 'react';
import { useT } from '../../../shared/lib/useT';
import { Badge } from '../../../shared/ui/Badge';
import { Button } from '../../../shared/ui/Button';
import styles from './OperationsPanel.module.css';

export interface OperationActionsProps {
  readonly operation: ApiOperationDto;
  /** 本服务对该操作尚未有结论的申请；有则不再重复申请。 */
  readonly pendingRequest: ApiRequestDto | undefined;
  /** 打开「申请定向开放」弹窗（2026-09-23 起申请表单在弹窗里，不在详情栏展开）。 */
  readonly onRequest: (operation: ApiOperationDto) => void;
}

/** 项目只消费能力：有待审批的申请时标出来，需要申请时给「申请定向开放」。 */
export function OperationActions({ operation, pendingRequest, onRequest }: OperationActionsProps): ReactElement {
  const t = useT();
  const needsRequest = operation.openPolicy === 'targeted' && operation.granted !== true;
  return (
    <div className={styles.rowActions}>
      {pendingRequest !== undefined ? <Badge tone="info">{t('catalog.request.pending')}</Badge> : null}
      {needsRequest && pendingRequest === undefined ? <Button onClick={() => onRequest(operation)}>{t('catalog.request.action')}</Button> : null}
    </div>
  );
}
