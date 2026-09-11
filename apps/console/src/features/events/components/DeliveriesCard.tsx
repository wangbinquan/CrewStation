import type { DeliveryState } from '@crewstation/contracts';
import { useState } from 'react';
import type { ReactElement } from 'react';
import { api } from '../../../shared/api/client';
import { queryKeys } from '../../../shared/api/queryKeys';
import { errorMessage, useApiMutation, useApiQuery } from '../../../shared/api/useApi';
import { useT } from '../../../shared/lib/useT';
import { Card } from '../../../shared/ui/Card';
import { usePollingRefetch } from '../hooks/usePollingRefetch';
import { DeliveryRow } from './DeliveryRow';
import { DeliveryStateFilter } from './DeliveryStateFilter';
import { EventsTable } from './EventsTable';
import { QueryStatus } from './QueryStatus';
import styles from './DeliveriesCard.module.css';

const PAGE_SIZE = 50;
const POLL_MS = 10_000;

/** 投递记录：按状态过滤，10 秒轮询一次，死信可由负责人重新入队。 */
export function DeliveriesCard({ projectId }: { readonly projectId: string }): ReactElement {
  const t = useT();
  const [state, setState] = useState<DeliveryState | ''>('');
  const enabled = projectId !== '';
  // 过滤条件进入查询键，切换状态即换一份缓存；失效时按 deliveries 前缀命中所有过滤条件。
  const deliveries = useApiQuery(
    [...queryKeys.deliveries(projectId), state],
    () => api.events.listDeliveries(projectId, { state: state === '' ? undefined : state, limit: PAGE_SIZE }),
    { enabled },
  );
  usePollingRefetch(deliveries.refetch, POLL_MS, enabled);
  const me = useApiQuery(queryKeys.me(), () => api.me.get());
  const canReplay = me.data?.isAdmin === true || (me.data?.memberships ?? []).some((member) => member.projectId === projectId && member.role === 'owner');
  const replay = useApiMutation((deliveryId: string) => api.events.replayDelivery(deliveryId), { invalidate: [queryKeys.deliveries(projectId)] });
  const items = deliveries.data?.items ?? [];
  const columns = [
    t('events.deliveries.eventType'), t('events.deliveries.state'), t('events.deliveries.attempts'), t('events.deliveries.traceId'),
    t('events.deliveries.deliveredAt'), t('events.deliveries.nextAttemptAt'), t('events.deliveries.actions'),
  ];
  return (
    <Card title={t('events.deliveries.title')} extra={<DeliveryStateFilter value={state} onChange={setState} />} footer={t('events.deliveries.replayHint')}>
      {replay.error === null ? null : (
        <p className={styles.error} role="alert">
          {t('events.deliveries.replayError', { message: errorMessage(replay.error) })}
        </p>
      )}
      <QueryStatus
        isPending={deliveries.isPending}
        error={deliveries.error}
        isEmpty={items.length === 0}
        emptyTitle={t('events.deliveries.emptyTitle')}
        emptyDescription={t('events.deliveries.emptyDescription')}
      />
      {items.length > 0 ? (
        <EventsTable columns={columns}>
          {items.map((delivery) => (
            <DeliveryRow
              key={delivery.id}
              delivery={delivery}
              canReplay={canReplay}
              isReplaying={replay.isPending && replay.variables === delivery.id}
              onReplay={(deliveryId) => replay.mutate(deliveryId)}
            />
          ))}
        </EventsTable>
      ) : null}
    </Card>
  );
}
