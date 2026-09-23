import { useState } from 'react';
import { api } from '../../../../shared/api/client';
import { queryKeys } from '../../../../shared/api/queryKeys';
import { AUTO_REFRESH, errorMessage, useApiQuery } from '../../../../shared/api/useApi';
import { useT } from '../../../../shared/lib/useT';
import { ActionNote } from '../../../../shared/ui/ActionNote';
import { Button } from '../../../../shared/ui/Button';
import { Card } from '../../../../shared/ui/Card';
import { QueryStatus } from '../../../../shared/ui/QueryStatus';
import { useCatalogManagementActions } from '../../hooks/useCatalogManagementActions';
import { OperationFilters } from '../OperationFilters';
import type { OperationFilterValue } from '../OperationFilters';
import { OperationsTable } from '../OperationsTable';
import { CatalogPolicyActions } from './CatalogPolicyActions';

export function CatalogManagementOperations({ serviceId, projectName, proxy, operation, onClearContext }: {
  readonly serviceId?: string; readonly projectName?: string; readonly proxy?: string; readonly operation?: string; readonly onClearContext: () => void;
}) {
  const t = useT(), actions = useCatalogManagementActions();
  // 接口与授权每 30 秒在原位重读，读取失败自动重试；不提供「重新读取」（2026-09-23 裁定）。
  const query = useApiQuery(serviceId ? queryKeys.operations(serviceId) : ['operations', 'admin'], () => api.apiCatalog.listOperations(serviceId ? { serviceId } : undefined), AUTO_REFRESH);
  const [filter, setFilter] = useState<OperationFilterValue>({ proxy: '', grant: 'all' });
  const operations = query.data?.items ?? [], proxies = [...new Map(operations.map((item) => [item.proxyId, { id: item.proxyId, name: item.proxy }])).values()].sort((a, b) => a.name.localeCompare(b.name));
  const visible = operations.filter((item) => (!operation || item.id === operation) && (!proxy || item.proxyId === proxy) && (!filter.proxy || item.proxyId === filter.proxy)
    && (!serviceId || filter.grant === 'all' || (filter.grant === 'granted' ? item.granted === true : item.granted !== true)));
  const error = actions.setPolicy.error ?? actions.revoke.error;
  return <Card title={t('catalog.admin.operationsTitle')}>
    {operation || proxy ? <p>{t('catalog.context')} <code>{operation ?? proxy}</code> <Button size="small" variant="ghost" onClick={onClearContext}>{t('catalog.clearContext')}</Button></p> : null}
    <OperationFilters value={filter} proxies={proxies} count={visible.length} onChange={setFilter} showGrant={!!serviceId} />
    <QueryStatus isPending={query.isPending} error={query.error} isEmpty={visible.length === 0} emptyTitle={t('catalog.operations.emptyTitle')} emptyDescription={t('catalog.operations.emptyDescription')} />
    {error ? <ActionNote tone="error">{t('catalog.error.write', { message: errorMessage(error) })}</ActionNote> : null}
    {actions.setPolicy.isSuccess ? <ActionNote tone="success">{t('catalog.admin.policySaved', { key: actions.setPolicy.data.id, policy: t(`catalog.policy.${actions.setPolicy.data.openPolicy}`) })}</ActionNote> : null}
    {actions.revoke.isSuccess ? <ActionNote tone="success">{t('catalog.admin.revoked', { key: actions.revoke.variables.operationId })}</ActionNote> : null}
    {!query.error && visible.length > 0 ? <OperationsTable operations={visible} serviceContext={!!serviceId} renderActions={(item) => <CatalogPolicyActions operation={item} serviceId={serviceId} projectName={projectName} actions={actions} />} /> : null}
  </Card>;
}
