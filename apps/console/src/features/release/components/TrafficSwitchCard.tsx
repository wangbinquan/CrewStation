import type { ReactElement } from 'react';
import { api } from '../../../shared/api/client';
import { queryKeys } from '../../../shared/api/queryKeys';
import { useApiQuery } from '../../../shared/api/useApi';
import { useDateText } from '../../../shared/lib/useDateText';
import { useT } from '../../../shared/lib/useT';
import { Card } from '../../../shared/ui/Card';
import { DataTable } from '../../../shared/ui/DataTable';
import { QueryStatus } from '../../../shared/ui/QueryStatus';

/** 切流记录：每一行都是一次生产流量的切换，回滚同样记在这里。 */
export function TrafficSwitchCard({ serviceId }: { readonly serviceId: string }): ReactElement {
  const t = useT();
  const dateText = useDateText();
  const switches = useApiQuery(queryKeys.trafficSwitches(serviceId), () => api.services.listTrafficSwitches(serviceId));
  const items = switches.data?.items ?? [];
  const columns = [
    t('release.switches.columnFrom'), t('release.switches.columnTo'), t('release.switches.columnRelease'),
    t('release.switches.columnActor'), t('release.switches.columnReason'), t('release.switches.columnCreatedAt'),
  ];
  return (
    <Card title={t('release.switches.title')}>
      <QueryStatus isPending={switches.isPending} error={switches.error} loadingKey="release.switches.loading" errorKey="release.switches.error" />
      {items.length === 0 && !switches.isPending && switches.error === null ? <p>{t('release.switches.empty')}</p> : null}
      {items.length > 0 ? (
        <DataTable columns={columns}>
          {items.map((entry) => (
            <tr key={entry.id}>
              <td>{entry.fromSlot}</td>
              <td>{entry.toSlot}</td>
              <td>
                <code>{entry.releaseId}</code>
              </td>
              <td>
                <code>{entry.actorUserId}</code>
              </td>
              <td>{entry.reason ?? '—'}</td>
              <td>{dateText(entry.createdAt)}</td>
            </tr>
          ))}
        </DataTable>
      ) : null}
    </Card>
  );
}
