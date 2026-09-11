import type { ApiOperationDto, ApiRequestDto } from '@crewstation/contracts';
import { useState } from 'react';
import type { ReactElement } from 'react';
import { useT } from '../../../shared/lib/useT';
import { Badge } from '../../../shared/ui/Badge';
import { Button } from '../../../shared/ui/Button';
import type { CatalogActions } from '../hooks/useCatalogActions';
import { AccessRequestForm } from './AccessRequestForm';
import styles from './OperationsPanel.module.css';

export interface OperationActionsProps {
  readonly operation: ApiOperationDto;
  /** 本服务对该操作尚未有结论的申请；有则不再重复申请。 */
  readonly pendingRequest: ApiRequestDto | undefined;
  readonly isAdmin: boolean;
  readonly actions: CatalogActions;
}

/** 一行的可用动作：业务申请定向开放；管理员另可改开放策略、撤销已有授权。 */
export function OperationActions({ operation, pendingRequest, isAdmin, actions }: OperationActionsProps): ReactElement {
  const t = useT();
  const [requesting, setRequesting] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const needsRequest = operation.openPolicy === 'targeted' && operation.granted !== true;
  if (requesting) {
    return (
      <AccessRequestForm
        pending={actions.requestAccess.isPending}
        onCancel={() => setRequesting(false)}
        onSubmit={(reason) => {
          setRequesting(false);
          actions.requestAccess.mutate({ operationKey: operation.key, reason: reason.length > 0 ? reason : undefined });
        }}
      />
    );
  }
  return (
    <div className={styles.rowActions}>
      {pendingRequest !== undefined ? <Badge tone="info">{t('catalog.request.pending')}</Badge> : null}
      {needsRequest && pendingRequest === undefined ? (
        <Button variant="ghost" onClick={() => setRequesting(true)}>
          {t('catalog.request.action')}
        </Button>
      ) : null}
      {isAdmin ? (
        <Button
          variant="ghost"
          disabled={actions.setPolicy.isPending}
          onClick={() => actions.setPolicy.mutate({ operationKey: operation.key, openPolicy: operation.openPolicy === 'default' ? 'targeted' : 'default' })}
        >
          {operation.openPolicy === 'default' ? t('catalog.admin.toTargeted') : t('catalog.admin.toDefault')}
        </Button>
      ) : null}
      {isAdmin && operation.granted === true ? (
        <RevokeControl
          operationKey={operation.key}
          confirming={confirmRevoke}
          pending={actions.revokeGrant.isPending}
          onAsk={() => setConfirmRevoke(true)}
          onCancel={() => setConfirmRevoke(false)}
          onConfirm={() => {
            setConfirmRevoke(false);
            actions.revokeGrant.mutate(operation.key);
          }}
        />
      ) : null}
    </div>
  );
}

interface RevokeControlProps {
  readonly operationKey: string;
  readonly confirming: boolean;
  readonly pending: boolean;
  readonly onAsk: () => void;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}

/** 撤销授权的两步确认；不用 window.confirm（会冻结页面）。 */
function RevokeControl({ operationKey, confirming, pending, onAsk, onCancel, onConfirm }: RevokeControlProps): ReactElement {
  const t = useT();
  if (!confirming) {
    return (
      <Button variant="ghost" onClick={onAsk}>
        {t('catalog.admin.revoke')}
      </Button>
    );
  }
  return (
    <>
      <Button variant="primary" disabled={pending} onClick={onConfirm}>
        {t('catalog.admin.revokeConfirm', { key: operationKey })}
      </Button>
      <Button variant="ghost" onClick={onCancel}>
        {t('catalog.admin.cancel')}
      </Button>
    </>
  );
}
