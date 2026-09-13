import type { ApiOperationDto, ApiRequestDto } from '@crewstation/contracts';
import { useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import { errorMessage } from '../../../shared/api/useApi';
import { useT } from '../../../shared/lib/useT';
import { ActionNote } from '../../../shared/ui/ActionNote';
import { Button } from '../../../shared/ui/Button';
import { Card } from '../../../shared/ui/Card';
import { QueryStatus } from '../../../shared/ui/QueryStatus';
import type { CatalogActions } from '../hooks/useCatalogActions';
import { ALL_PROXIES, OperationFilters } from './OperationFilters';
import type { OperationFilterValue } from './OperationFilters';
import { OperationsTable } from './OperationsTable';
import { OperationActions } from './OperationActions';

const INITIAL_FILTER: OperationFilterValue = { proxy: ALL_PROXIES, grant: 'all' };

export interface OperationsPanelProps {
  readonly operations: readonly ApiOperationDto[];
  readonly requests: readonly ApiRequestDto[];
  readonly loading: boolean;
  readonly loadError: unknown;
  readonly actions: CatalogActions;
  readonly proxy?: string;
  readonly operation?: string;
  readonly onClearContext?: () => void;
}

/** 操作列表与筛选；写操作的失败原因原样显示，不吞掉服务端的说明。 */
export function OperationsPanel({ operations, requests, loading, loadError, actions, proxy, operation, onClearContext }: OperationsPanelProps): ReactElement {
  const t = useT();
  const [filter, setFilter] = useState<OperationFilterValue>(INITIAL_FILTER);
  const proxies = useMemo(() => [...new Set(operations.map((operation) => operation.proxy))].sort(), [operations]);
  const pendingByKey = useMemo(() => indexPending(requests), [requests]);
  const visible = useMemo(() => operations.filter((item) => (!operation || item.key === operation) && (!proxy || item.proxy === proxy) && matches(item, filter)), [operations, filter, operation, proxy]);
  const writeError = actions.requestAccess.error;
  return (
    <Card title={t('catalog.operations.title')}>
      {operation || proxy ? <p>{t('catalog.context')} <code>{operation ?? proxy}</code> <Button onClick={onClearContext}>{t('catalog.clearContext')}</Button></p> : null}
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
      {visible.length > 0 ? <OperationsTable operations={visible} renderActions={(item) => <OperationActions operation={item} pendingRequest={pendingByKey.get(item.key)} actions={actions} />} /> : null}
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
