import type { ReactElement } from 'react';
import { api } from '../../../shared/api/client';
import { queryKeys } from '../../../shared/api/queryKeys';
import { useApiMutation, useApiQuery } from '../../../shared/api/useApi';
import { useT } from '../../../shared/lib/useT';
import { Card } from '../../../shared/ui/Card';
import { DataTable } from '../../../shared/ui/DataTable';
import { QueryStatus } from '../../../shared/ui/QueryStatus';
import { EgressRequestRow } from './EgressRequestRow';
import { MutationError } from './MutationError';

interface DecideInput {
  readonly id: string;
  readonly approve: boolean;
  readonly decision: string;
}

/** 项目发起的放行申请：批准即生成一条项目范围条目，因此连同白名单键一起失效。 */
export function EgressRequestsSection(): ReactElement {
  const t = useT();
  const requests = useApiQuery(queryKeys.egressRequests(), () => api.egress.listRequests());
  const decide = useApiMutation((input: DecideInput) => api.egress.decideRequest(input.id, { approve: input.approve, decision: input.decision }), {
    invalidate: [queryKeys.egressRequests(), queryKeys.egressEntries()],
  });
  const items = requests.data?.items ?? [];
  const columns = [
    t('admin.egressRequests.fqdn'), t('admin.egressRequests.project'), t('admin.egressRequests.reason'),
    t('admin.egressRequests.state'), t('admin.egressRequests.decision'), t('admin.egressRequests.actions'),
  ];
  return (
    <Card title={t('admin.egressRequests.title')} footer={t('admin.egressRequests.hint')}>
      <MutationError error={decide.error} messageKey="admin.egressRequests.decideError" />
      <QueryStatus
        isPending={requests.isPending}
        error={requests.error}
        isEmpty={items.length === 0}
        emptyTitle={t('admin.egressRequests.emptyTitle')}
        emptyDescription={t('admin.egressRequests.emptyDescription')}
      />
      {items.length > 0 ? (
        <DataTable columns={columns}>
          {items.map((request) => (
            <EgressRequestRow
              key={request.id}
              request={request}
              busy={decide.isPending && decide.variables?.id === request.id}
              onDecide={(id, approve, decision) => decide.mutate({ id, approve, decision })}
            />
          ))}
        </DataTable>
      ) : null}
    </Card>
  );
}
