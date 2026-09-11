import type { ReactElement } from 'react';
import { api } from '../../../shared/api/client';
import { queryKeys } from '../../../shared/api/queryKeys';
import { useApiQuery } from '../../../shared/api/useApi';
import { useT } from '../../../shared/lib/useT';
import { Badge } from '../../../shared/ui/Badge';
import { Card } from '../../../shared/ui/Card';
import { EventsTable } from './EventsTable';
import { QueryStatus } from './QueryStatus';

/** 本服务在 Manifest subscriptions 段声明、并在发布登记时生效的订阅。 */
export function SubscriptionsCard({ projectId }: { readonly projectId: string }): ReactElement {
  const t = useT();
  const subscriptions = useApiQuery(queryKeys.subscriptions(projectId), () => api.events.listSubscriptions(projectId), { enabled: projectId !== '' });
  const items = subscriptions.data?.items ?? [];
  return (
    <Card title={t('events.subscriptions.title')} footer={t('events.subscriptions.hint')}>
      <QueryStatus
        isPending={subscriptions.isPending}
        error={subscriptions.error}
        isEmpty={items.length === 0}
        emptyTitle={t('events.subscriptions.emptyTitle')}
        emptyDescription={t('events.subscriptions.emptyDescription')}
      />
      {items.length > 0 ? (
        <EventsTable columns={[t('events.subscriptions.eventType'), t('events.subscriptions.handlerPath'), t('events.subscriptions.state')]}>
          {items.map((subscription) => (
            <tr key={subscription.id}>
              <td>
                <code>{subscription.eventType}</code>
              </td>
              <td>
                <code>{subscription.handlerPath}</code>
              </td>
              <td>
                <Badge tone={subscription.state === 'active' ? 'success' : 'neutral'}>{t(`events.subscriptionState.${subscription.state}`)}</Badge>
              </td>
            </tr>
          ))}
        </EventsTable>
      ) : null}
    </Card>
  );
}
