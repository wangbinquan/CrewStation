import type { ApiOperationDto, ApiRequestDto } from '@crewstation/contracts';
import { useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import { errorMessage } from '../../../shared/api/useApi';
import { useT } from '../../../shared/lib/useT';
import { ActionNote } from '../../../shared/ui/ActionNote';
import { Badge } from '../../../shared/ui/Badge';
import { Card } from '../../../shared/ui/Card';
import { QueryStatus } from '../../../shared/ui/QueryStatus';
import type { CatalogActions } from '../hooks/useCatalogActions';
import { ALL_PROXIES, OperationFilters } from './OperationFilters';
import type { OperationFilterValue } from './OperationFilters';
import { OperationsTable } from './OperationsTable';

const INITIAL_FILTER: OperationFilterValue = { proxy: ALL_PROXIES, grant: 'all' };

export interface OperationsPanelProps {
  readonly operations: readonly ApiOperationDto[];
  readonly requests: readonly ApiRequestDto[];
  readonly loading: boolean;
  readonly loadError: unknown;
  readonly isAdmin: boolean;
  readonly actions: CatalogActions;
}

/** 操作列表与筛选；写操作的失败原因原样显示，不吞掉服务端的说明。 */
export function OperationsPanel({ operations, requests, loading, loadError, isAdmin, actions }: OperationsPanelProps): ReactElement {
  const t = useT();
  const [filter, setFilter] = useState<OperationFilterValue>(INITIAL_FILTER);
  const proxies = useMemo(() => [...new Set(operations.map((operation) => operation.proxy))].sort(), [operations]);
  const pendingByKey = useMemo(() => indexPending(requests), [requests]);
  const visible = useMemo(() => operations.filter((operation) => matches(operation, filter)), [operations, filter]);
  const writeError = actions.requestAccess.error ?? actions.setPolicy.error ?? actions.decide.error ?? actions.revokeGrant.error;
  return (
    <Card title={t('catalog.operations.title')} extra={isAdmin ? <Badge tone="info">{t('catalog.admin.badge')}</Badge> : undefined}>
      <OperationFilters value={filter} proxies={proxies} count={visible.length} onChange={setFilter} />
      <QueryStatus
        isPending={loading}
        error={loadError}
        loadingKey="catalog.operations.loading"
        errorKey="catalog.error.load"
        isEmpty={visible.length === 0}
        emptyTitle={t('catalog.operations.emptyTitle')}
        emptyDescription={t('catalog.operations.emptyDescription')}
      />
      {writeError ? <ActionNote tone="error">{t('catalog.error.write', { message: errorMessage(writeError) })}</ActionNote> : null}
      {visible.length > 0 ? <OperationsTable operations={visible} pendingByKey={pendingByKey} isAdmin={isAdmin} actions={actions} /> : null}
    </Card>
  );
}

/** 只有 pending 会挡住再次申请；已批准或已拒绝的申请不影响再次提交。 */
function indexPending(requests: readonly ApiRequestDto[]): ReadonlyMap<string, ApiRequestDto> {
  const map = new Map<string, ApiRequestDto>();
  for (const request of requests) if (request.state === 'pending') map.set(request.operationKey, request);
  return map;
}

function matches(operation: ApiOperationDto, filter: OperationFilterValue): boolean {
  if (filter.proxy !== ALL_PROXIES && operation.proxy !== filter.proxy) return false;
  if (filter.grant === 'granted') return operation.granted === true;
  if (filter.grant === 'not-granted') return operation.granted !== true;
  return true;
}
