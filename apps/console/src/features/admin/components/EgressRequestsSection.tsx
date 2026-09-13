import { useRef } from 'react';
import { Link } from '@tanstack/react-router';
import type { ReactElement } from 'react';
import { api } from '../../../shared/api/client';
import { queryKeys } from '../../../shared/api/queryKeys';
import { useApiMutation, useApiQuery } from '../../../shared/api/useApi';
import { useT } from '../../../shared/lib/useT';
import { Card } from '../../../shared/ui/Card';
import { DataTable } from '../../../shared/ui/DataTable';
import { QueryStatus } from '../../../shared/ui/QueryStatus';
import { Button } from '../../../shared/ui/Button';
import { ActionNote } from '../../../shared/ui/ActionNote';
import type { RequestStatus } from '../../../shared/admin/managementSearch';
import { EgressRequestRow } from './EgressRequestRow';
import { MutationError } from './MutationError';
import styles from './EgressRequestsSection.module.css';

interface DecideInput {
  readonly id: string;
  readonly approve: boolean;
  readonly decision: string;
}

/** 项目发起的放行申请：批准即生成一条项目范围条目，因此连同白名单键一起失效。 */
export function EgressRequestsSection({ projectId, state = 'all' }: { readonly projectId?: string; readonly state?: RequestStatus }): ReactElement {
  const t = useT(), busy = useRef(false);
  const requests = useApiQuery(queryKeys.egressRequests(projectId), () => api.egress.listRequests(projectId ? { projectId } : undefined));
  const projects = useApiQuery(queryKeys.adminProjects(), () => api.projects.list());
  const decide = useApiMutation((input: DecideInput) => api.egress.decideRequest(input.id, { approve: input.approve, decision: input.decision }), {
    invalidate: [queryKeys.egressRequests(), queryKeys.egressEntries()],
  });
  const items = (requests.data?.items ?? []).filter((item) => state === 'all' || item.state === state);
  const forbidden = [401, 403, 404].includes(requests.error?.status ?? 0);
  const columns = [
    t('admin.egressRequests.fqdn'), t('admin.egressRequests.project'), t('admin.egressRequests.reason'),
    t('admin.egressRequests.state'), t('admin.egressRequests.decision'), t('admin.egressRequests.actions'),
  ];
  return (
    <Card title={t('admin.egressRequests.title')} footer={t('admin.egressRequests.hint')} extra={<Button disabled={requests.isFetching || decide.isPending} onClick={() => void requests.refetch()}>{t('admin.requests.refreshEgress')}</Button>}>
      <MutationError error={decide.error} messageKey="admin.egressRequests.decideError" />
      <QueryStatus
        isPending={requests.isPending}
        error={requests.error}
        isEmpty={items.length === 0}
        emptyTitle={t('admin.egressRequests.emptyTitle')}
        emptyDescription={t('admin.egressRequests.emptyDescription')}
      />
      {requests.error && items.length > 0 && !forbidden ? <ActionNote tone="neutral">{t('admin.requests.lastRecords')}</ActionNote> : null}
      {!forbidden && items.length > 0 ? (
        <DataTable columns={columns} className={styles.table}>
          {items.map((request) => (
            <EgressRequestRow
              key={request.id}
              request={request}
              projectLabel={projects.error ? undefined : projects.data?.items.find((project) => project.id === request.projectId)?.name}
              projectLink={<Link to="/admin/requests" search={{ tab: 'egress', state, projectId: request.projectId }}>{t('admin.requests.filterProject')}</Link>}
              busy={decide.isPending || requests.isFetching || !!requests.error}
              onDecide={(id, approve, decision) => {
                if (busy.current || requests.isFetching || requests.error) return; busy.current = true;
                decide.mutate({ id, approve, decision }, { onSettled: () => { busy.current = false; } });
              }}
            />
          ))}
        </DataTable>
      ) : null}
    </Card>
  );
}
