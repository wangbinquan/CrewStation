import type { ApiOperationDto, ApiRequestDto } from '@crewstation/contracts';
import { useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { useT } from '../../../shared/lib/useT';
import { Badge } from '../../../shared/ui/Badge';
import { Button } from '../../../shared/ui/Button';
import { errorMessage } from '../../../shared/api/useApi';
import type { CatalogActions } from '../hooks/useCatalogActions';
import { AccessRequestForm } from './AccessRequestForm';
import styles from './OperationsPanel.module.css';

export interface OperationActionsProps {
  readonly operation: ApiOperationDto;
  /** 本服务对该操作尚未有结论的申请；有则不再重复申请。 */
  readonly pendingRequest: ApiRequestDto | undefined;
  readonly actions: CatalogActions;
  /** 给了就不在这里展开表单，而是交给调用方（放大形态里表单在详情栏）。 */
  readonly onRequest?: (operation: ApiOperationDto) => void;
  readonly initiallyRequesting?: boolean;
  /** 给了就只渲染申请表单：取消或受理后交还调用方收起（列表行下原地展开时用）。 */
  readonly onClose?: () => void;
}

/** 项目只消费能力；失败保留理由，成功受理后才收起申请。 */
export function OperationActions({ operation, pendingRequest, actions, onRequest, initiallyRequesting = false, onClose }: OperationActionsProps): ReactElement | null {
  const t = useT();
  const [requesting, setRequesting] = useState((initiallyRequesting || !!onClose) && !onRequest);
  const stop = (): void => { if (onClose) onClose(); else setRequesting(false); };
  const submitting = useRef(false);
  const needsRequest = operation.openPolicy === 'targeted' && operation.granted !== true;
  if (requesting) {
    return (
      <AccessRequestForm
        pending={actions.requestAccess.isPending}
        error={actions.requestAccess.variables?.operationId === operation.id && actions.requestAccess.error ? errorMessage(actions.requestAccess.error) : undefined}
        onCancel={stop}
        onSubmit={(reason) => {
          if (submitting.current) return;
          submitting.current = true;
          actions.requestAccess.mutate({ operationId: operation.id, reason: reason.length > 0 ? reason : undefined }, { onSuccess: stop, onSettled: () => { submitting.current = false; } });
        }}
      />
    );
  }
  if (onClose) return null;
  return (
    <div className={styles.rowActions}>
      {pendingRequest !== undefined ? <Badge tone="info">{t('catalog.request.pending')}</Badge> : null}
      {needsRequest && pendingRequest === undefined ? (
        <Button variant="ghost" onClick={() => (onRequest ? onRequest(operation) : setRequesting(true))}>
          {t('catalog.request.action')}
        </Button>
      ) : null}
    </div>
  );
}
