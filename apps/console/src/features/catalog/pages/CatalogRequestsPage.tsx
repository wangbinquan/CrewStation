import { Link } from '@tanstack/react-router';
import { useRef } from 'react';
import { errorMessage } from '../../../shared/api/useApi';
import type { RequestReviewPageProps } from '../../../shared/admin/requestPageState';
import { useRequestDrafts } from '../../../shared/admin/useRequestDrafts';
import { RequestDraftNotice } from '../../../shared/admin/RequestDraftNotice';
import { RequestPageControls } from '../../../shared/admin/RequestPageControls';
import { useT } from '../../../shared/lib/useT';
import { ActionNote } from '../../../shared/ui/ActionNote';
import { Button } from '../../../shared/ui/Button';
import { RequestsPanel } from '../components/RequestsPanel';
import { useCatalogRequestReview } from '../hooks/useCatalogRequestReview';

export function CatalogRequestsPage({ projectId, state, cursor, active, onPage, onDirtyChange }: RequestReviewPageProps) {
  const t = useT(), review = useCatalogRequestReview({ projectId, state, cursor }, active), busy = useRef(false);
  const { requests, decide } = review, drafts = useRequestDrafts(decide.isPending, onDirtyChange);
  const items = requests.data?.items ?? [];
  const forbidden = [401, 403, 404].includes(requests.error?.status ?? 0);
  const shown = forbidden ? [] : items, paused = !active || review.busy || decide.isPending || !!requests.error;
  const submit = (id: string, approve: boolean, decision?: string) => {
    const request = shown.find((item) => item.id === id && item.state === 'pending');
    if (busy.current || paused || !request) return; busy.current = true;
    const sentValue = drafts.read(id);
    decide.mutate({ request, approve, decision }, { onSuccess: () => drafts.discard(id, sentValue), onSettled: () => { busy.current = false; } });
  };
  return <>
    <p><Button disabled={review.busy || decide.isPending} onClick={() => void requests.refetch({ cancelRefetch: false })}>{t('catalog.admin.refreshRequests')}</Button></p>
    <RequestPageControls scope={t('admin.requests.api')} cursor={cursor} nextCursor={requests.data?.nextCursor} busy={review.busy || decide.isPending}
      count={requests.isPending || requests.error ? undefined : items.length} updatedAt={requests.dataUpdatedAt} onPage={onPage} />
    {decide.error ? <ActionNote tone="error">{t('ui.requestPage.decisionError', { message: errorMessage(decide.error) })}</ActionNote> : null}
    {decide.isSuccess ? <ActionNote tone="success">{t('catalog.admin.decided', { key: decide.data.operationId, state: t(decide.data.state === 'approved' ? 'catalog.requests.stateApproved' : 'catalog.requests.stateRejected') })}</ActionNote> : null}
    <RequestsPanel requests={shown} loading={requests.isPending} loadError={requests.error} title={t('catalog.admin.requestsTitle')} empty={t('catalog.admin.requestsEmpty')}
      renderService={(serviceId) => {
        const item = shown.find((request) => request.serviceId === serviceId), project = item?.project;
        return <p>{item ? <Link to="/admin/capabilities" search={{ tab: 'api', projectId: item.projectId }}>{project ? `${project.name} · ${project.slug}` : item.projectId}</Link> : null} · <code>{serviceId}</code>
          {item ? <> · <Link to="/admin/requests" search={{ state, projectId: item.projectId }}>{t('admin.requests.filterProject')}</Link></> : null}</p>;
      }}
      management={{ busy: paused, onDecide: submit, decisionFor: drafts.read, onDecisionChange: (id, value) => {
        const item = shown.find((request) => request.id === id); if (item) drafts.change(id, `${item.project?.name ?? item.projectId} · ${item.operationId}`, value);
      } }} />
    <RequestDraftNotice drafts={drafts.entries} pendingIds={shown.filter((r) => r.state === 'pending').map((r) => r.id)} busy={decide.isPending} onDiscard={drafts.discard} />
    {requests.error && items.length > 0 && !forbidden ? <ActionNote tone="neutral">{t('catalog.admin.lastRequests')}</ActionNote> : null}
  </>;
}
