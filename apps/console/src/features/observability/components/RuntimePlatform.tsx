import { useState } from 'react';
import { api } from '../../../shared/api/client';
import { useT } from '../../../shared/lib/useT';
import { Card } from '../../../shared/ui/Card';
import { DataTable } from '../../../shared/ui/DataTable';
import { QueryStatus } from '../../../shared/ui/QueryStatus';
import { Stack } from '../../../shared/ui/Stack';
import { CatalogPagination } from '../../../shared/ui/catalog/CatalogPagination';
import { useObservation } from '../hooks/useObservation';
import { countText } from '../model/runtimeFormat';
import type { RuntimePeriod } from '../model/runtimeSearch';
import { RuntimeCallTable } from './RuntimeCallTable';
import { UsageCost, UsageNotes, UsageTokens } from './RuntimeUsage';

/** 不属于项目的平台执行（档位测试等）：按类别汇总，最近执行按开始时间倒序分页。 */
export function RuntimePlatform({ period }: { period: RuntimePeriod }) {
  const t = useT(), [cursor, setCursor] = useState<string>();
  const query = useObservation(['platform', cursor ?? ''], period, (window) => api.observability.platform({ ...window, ...(cursor ? { cursor } : {}) }));
  const data = query.error ? undefined : query.data;
  return <Stack>
    <Card title={t('runtime.platformKinds')} footer={t('runtime.platformHint')}>
      <QueryStatus isPending={query.isPending} error={query.error} isEmpty={data?.kinds.length === 0} emptyTitle={t('runtime.emptyPlatform')} />
      {data?.kinds.length ? <DataTable columns={[t('runtime.column.kind'), t('runtime.column.calls'), t('runtime.column.tokens'), t('runtime.column.cost')]}>
        {data.kinds.map((row) => <tr key={row.kind}>
          <td>{t('runtime.kind.' + row.kind)}</td>
          <td>{countText(row.usage.calls)}<UsageNotes usage={row.usage} /></td>
          <td><UsageTokens usage={row.usage} /></td>
          <td><UsageCost usage={row.usage} /></td>
        </tr>)}
      </DataTable> : null}
    </Card>
    <Card title={t('runtime.platformRecent')} stacked>
      {data?.recent.length ? <RuntimeCallTable calls={data.recent} asOf={data.asOf} costVisible withTask /> : null}
      <CatalogPagination scope="runtime-platform" filter={period} cursor={cursor} next={data?.nextCursor ?? undefined}
        count={data ? data.recent.length : undefined} disabled={query.isPending || !!query.error} onChange={setCursor} />
    </Card>
  </Stack>;
}
