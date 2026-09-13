import { Link } from '@tanstack/react-router';
import { useRef } from 'react';
import { api } from '../../../shared/api/client';
import { queryKeys } from '../../../shared/api/queryKeys';
import { errorMessage, useApiQuery } from '../../../shared/api/useApi';
import type { RequestStatus } from '../../../shared/admin/managementSearch';
import { useT } from '../../../shared/lib/useT';
import { ActionNote } from '../../../shared/ui/ActionNote';
import { Button } from '../../../shared/ui/Button';
import { RequestsPanel } from '../components/RequestsPanel';
import { useCatalogManagementActions } from '../hooks/useCatalogManagementActions';

export function CatalogRequestsPage({ projectId, state }: { readonly projectId?: string; readonly state: RequestStatus }) {
  const t = useT(), actions = useCatalogManagementActions(), busy = useRef(false);
  const requests = useApiQuery([...queryKeys.accessRequests(), 'admin', projectId ?? 'all'], () => api.apiCatalog.listRequests(projectId ? { projectId } : undefined));
  const projects = useApiQuery(queryKeys.adminProjects(), () => api.projects.list());
  const items = (requests.data?.items ?? []).filter((item) => state === 'all' || item.state === state);
  const forbidden = [401, 403, 404].includes(requests.error?.status ?? 0);
  return <>
    <p><Button disabled={requests.isFetching || actions.decide.isPending} onClick={() => void requests.refetch()}>{t('catalog.admin.refreshRequests')}</Button></p>
    {actions.decide.error ? <ActionNote tone="error">{t('catalog.error.write', { message: errorMessage(actions.decide.error) })}</ActionNote> : null}
    {actions.decide.isSuccess ? <ActionNote tone="success">{t('catalog.admin.decided', { key: actions.decide.data.operationKey, state: t(actions.decide.data.state === 'approved' ? 'catalog.requests.stateApproved' : 'catalog.requests.stateRejected') })}</ActionNote> : null}
    <RequestsPanel requests={forbidden ? [] : items} loading={requests.isPending} loadError={requests.error} title={t('catalog.admin.requestsTitle')} empty={t('catalog.admin.requestsEmpty')}
      renderService={(serviceId) => {
        const project = !projects.error ? projects.data?.items.find((item) => item.serviceId === serviceId) : undefined;
        return project ? <p><Link to="/admin/capabilities" search={{ tab: 'api', projectId: project.id }}>{project.name} · {project.slug}</Link> · <code>{serviceId}</code></p> : <p>{t('catalog.admin.currentService')} <code>{serviceId}</code></p>;
      }}
      management={{ busy: actions.decide.isPending || requests.isFetching || !!requests.error, onDecide: (id, approve, decision) => {
        if (busy.current || requests.isFetching || requests.error) return; busy.current = true;
        actions.decide.mutate({ id, approve, decision }, { onSettled: () => { busy.current = false; } });
      } }} />
    {requests.error && items.length > 0 && !forbidden ? <ActionNote tone="neutral">{t('catalog.admin.lastRequests')}</ActionNote> : null}
  </>;
}
