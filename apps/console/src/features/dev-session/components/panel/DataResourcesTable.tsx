import type { ReactElement } from 'react';
import { api } from '../../../../shared/api/client';
import { queryKeys } from '../../../../shared/api/queryKeys';
import { useApiQuery } from '../../../../shared/api/useApi';
import { useT } from '../../../../shared/lib/useT';
import { Badge } from '../../../../shared/ui/Badge';
import { Card } from '../../../../shared/ui/Card';
import { CopyButton } from '../../../../shared/ui/clipboard/CopyButton';
import { DataTable } from '../../../../shared/ui/DataTable';
import { QueryStatus } from '../../../../shared/ui/QueryStatus';

/** 数据面板上半：平台提供的数据资源与连接变量名（原开发资源 → 数据与存储，RFC-020 D2）；值只注入容器。 */
export function DataResourcesTable({ projectId }: { readonly projectId: string }): ReactElement {
  const t = useT();
  const resources = useApiQuery(queryKeys.dataResources(projectId), () => api.tasks.listDataResources(projectId));
  const items = resources.data?.items ?? [];
  return <Card compact title={t('devSession.data.resources')}>
    <p>{t('devSession.data.resourcesNote')}</p>
    <QueryStatus isPending={resources.isPending} error={resources.error} isEmpty={!resources.isPending && !resources.error && items.length === 0} emptyTitle={t('devSession.data.resourcesEmpty')} />
    {items.length > 0 ? <DataTable columns={[t('devSession.data.resourceKind'), t('devSession.data.resourceEnv'), t('devSession.data.resourcePlan'), t('devSession.data.resourceState'), t('devSession.data.resourceEnvVar')]}>
      {items.map((row) => <tr key={row.id}>
        <td><code>{row.kind}</code></td><td>{t(`config.env.${row.env}`)}</td><td>{row.plan}</td>
        <td><Badge tone={row.state === 'ready' ? 'success' : 'neutral'}>{row.state}</Badge>{row.message ? <p>{row.message}</p> : null}</td>
        <td><code>{row.envVar}</code> <CopyButton value={row.envVar} /></td>
      </tr>)}
    </DataTable> : null}
  </Card>;
}
