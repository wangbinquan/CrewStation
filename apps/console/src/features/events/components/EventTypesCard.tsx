import type { ReactElement } from 'react';
import { Link } from '@tanstack/react-router';
import { ProjectIdSchema } from '@crewstation/contracts';
import { api } from '../../../shared/api/client';
import { queryKeys } from '../../../shared/api/queryKeys';
import { useApiQuery } from '../../../shared/api/useApi';
import { useT } from '../../../shared/lib/useT';
import { Card } from '../../../shared/ui/Card';
import { DataTable } from '../../../shared/ui/DataTable';
import { QueryStatus } from '../../../shared/ui/QueryStatus';

/** 平台事件类型目录：由 EventProducer 接入容器发布时登记，订阅只能引用其中的类型。 */
export function EventTypesCard({ management = false }: { readonly management?: boolean }): ReactElement {
  const t = useT();
  const eventTypes = useApiQuery(queryKeys.eventTypes(), () => api.events.listEventTypes());
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
        <DataTable
          columns={[t('events.eventTypes.eventType'), t('events.eventTypes.producer'), t('events.eventTypes.producerProject'), t('events.eventTypes.schemaRef')]}
        >
          {items.map((eventType) => (
            <tr key={eventType.eventType}>
              <td>
                <code>{eventType.eventType}</code>
              </td>
              <td>{eventType.producer}</td>
              <td>
                {management ? ProjectIdSchema.safeParse(eventType.producerProject).success
                  ? <Link to="/admin/integrations/$projectId" params={{ projectId: eventType.producerProject }}>{eventType.producerProject}</Link>
                  : <Link to="/admin/capabilities" search={{ tab: 'integrations', q: eventType.producerProject }}>{eventType.producerProject}</Link>
                  : <code>{eventType.producerProject}</code>}
              </td>
              <td>{eventType.schemaRef ?? t('events.none')}</td>
            </tr>
          ))}
        </DataTable>
      ) : null}
    </Card>
  );
}
