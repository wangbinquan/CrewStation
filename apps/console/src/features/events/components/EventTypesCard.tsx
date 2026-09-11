import type { ReactElement } from 'react';
import { api } from '../../../shared/api/client';
import { useApiQuery } from '../../../shared/api/useApi';
import { useT } from '../../../shared/lib/useT';
import { Card } from '../../../shared/ui/Card';
import { EventsTable } from './EventsTable';
import { QueryStatus } from './QueryStatus';

/** 平台事件类型目录：由 EventProducer 接入容器发布时登记，订阅只能引用其中的类型。 */
export function EventTypesCard(): ReactElement {
  const t = useT();
  // 目录是平台级的，与项目无关，因此用 catalog 自己的键而不是项目键。
  const eventTypes = useApiQuery(['catalog', 'event-types'], () => api.events.listEventTypes());
  const items = eventTypes.data?.items ?? [];
  return (
    <Card title={t('events.eventTypes.title')} footer={t('events.eventTypes.hint')}>
      <QueryStatus
        isPending={eventTypes.isPending}
        error={eventTypes.error}
        isEmpty={items.length === 0}
        emptyTitle={t('events.eventTypes.emptyTitle')}
        emptyDescription={t('events.eventTypes.emptyDescription')}
      />
      {items.length > 0 ? (
        <EventsTable
          columns={[t('events.eventTypes.eventType'), t('events.eventTypes.producer'), t('events.eventTypes.producerProject'), t('events.eventTypes.schemaRef')]}
        >
          {items.map((eventType) => (
            <tr key={eventType.eventType}>
              <td>
                <code>{eventType.eventType}</code>
              </td>
              <td>{eventType.producer}</td>
              <td>
                <code>{eventType.producerProject}</code>
              </td>
              <td>{eventType.schemaRef ?? t('events.none')}</td>
            </tr>
          ))}
        </EventsTable>
      ) : null}
    </Card>
  );
}
