import { useRef } from 'react';
import { Link } from '@tanstack/react-router';
import type { ReactElement } from 'react';
import { errorMessage } from '../../../shared/api/useApi';
import { useT } from '../../../shared/lib/useT';
import { Card } from '../../../shared/ui/Card';
import { DataTable } from '../../../shared/ui/DataTable';
import { QueryStatus } from '../../../shared/ui/QueryStatus';
import { Button } from '../../../shared/ui/Button';
import { ActionNote } from '../../../shared/ui/ActionNote';
import type { RequestReviewPageProps } from '../../../shared/admin/requestPageState';
import { RequestDraftNotice } from '../../../shared/admin/RequestDraftNotice';
import { RequestPageControls } from '../../../shared/admin/RequestPageControls';
import { useRequestDrafts } from '../../../shared/admin/useRequestDrafts';
import { useEgressRequestReview } from '../hooks/useEgressRequestReview';
import { EgressRequestRow } from './EgressRequestRow';
import styles from './EgressRequestsSection.module.css';

/** 项目发起的放行申请：批准即生成一条项目范围条目，因此连同白名单键一起失效。 */
export function EgressRequestsSection({ projectId, state, cursor, active, onPage, onDirtyChange }: RequestReviewPageProps): ReactElement {
  const t = useT(), busy = useRef(false), review = useEgressRequestReview({ projectId, state, cursor }, active);
  const { requests, decide } = review, drafts = useRequestDrafts(decide.isPending, onDirtyChange), items = requests.data?.items ?? [];
  const forbidden = [401, 403, 404].includes(requests.error?.status ?? 0);
  const shown = forbidden ? [] : items, paused = !active || review.busy || decide.isPending || !!requests.error;
  const submit = (id: string, approve: boolean, decision: string) => {
    const request = shown.find((item) => item.id === id && item.state === 'pending');
    if (busy.current || paused || !request) return; busy.current = true;
    const sentValue = drafts.read(id);
    decide.mutate({ request, approve, decision }, { onSuccess: () => drafts.discard(id, sentValue), onSettled: () => { busy.current = false; } });
  };
  const columns = [
    t('admin.egressRequests.fqdn'), t('admin.egressRequests.project'), t('admin.egressRequests.reason'),
    t('admin.egressRequests.state'), t('admin.egressRequests.decision'), t('admin.egressRequests.actions'),
  ];
  return (
    <Card compact title={t('admin.egressRequests.title')} footer={t('admin.egressRequests.hint')} extra={<Button disabled={review.busy || decide.isPending} onClick={() => void requests.refetch({ cancelRefetch: false })}>{t('admin.requests.refreshEgress')}</Button>}>
      <RequestPageControls scope={t('admin.requests.egress')} cursor={cursor} nextCursor={requests.data?.nextCursor} busy={review.busy || decide.isPending}
        count={requests.isPending || requests.error ? undefined : items.length} updatedAt={requests.dataUpdatedAt} onPage={onPage} />
      {decide.error ? <ActionNote tone="error">{t('ui.requestPage.decisionError', { message: errorMessage(decide.error) })}</ActionNote> : null}
      {decide.isSuccess ? <ActionNote tone="success">{t('ui.requestPage.decided', { target: decide.data.fqdn, state: t(`admin.egressRequestState.${decide.data.state}`) })}</ActionNote> : null}
      <QueryStatus
        isPending={requests.isPending}
        error={requests.error}
        isEmpty={items.length === 0}
        emptyTitle={t('admin.egressRequests.emptyTitle')}
        emptyDescription={t('admin.egressRequests.emptyDescription')}
      />
      {requests.error && items.length > 0 && !forbidden ? <ActionNote tone="neutral">{t('admin.requests.lastRecords')}</ActionNote> : null}
      {shown.length > 0 ? (
        <DataTable columns={columns} className={styles.table}>
          {shown.map((request) => (
            <EgressRequestRow
              key={request.id}
              request={request}
              projectLabel={request.project ? `${request.project.name} · ${request.project.slug}` : undefined}
              projectLink={<Link to="/admin/requests" search={{ tab: 'egress', state, projectId: request.projectId }}>{t('admin.requests.filterProject')}</Link>}
              busy={paused} decision={drafts.read(request.id)} onDecisionChange={(value) => drafts.change(request.id, `${request.project?.name ?? request.projectId} · ${request.fqdn}`, value)}
              onDecide={submit}
            />
          ))}
        </DataTable>
      ) : null}
      <RequestDraftNotice drafts={drafts.entries} pendingIds={shown.filter((r) => r.state === 'pending').map((r) => r.id)} busy={decide.isPending} onDiscard={drafts.discard} />
    </Card>
  );
}
