import { api } from '../../../shared/api/client';
import { useT } from '../../../shared/lib/useT';
import { Card } from '../../../shared/ui/Card';
import { DataTable } from '../../../shared/ui/DataTable';
import { QueryStatus } from '../../../shared/ui/QueryStatus';
import { useObservation } from '../hooks/useObservation';
import { countText } from '../model/runtimeFormat';
import type { RuntimePeriod } from '../model/runtimeSearch';
import { RuntimeProjectLink } from './RuntimeLinks';
import { UsageCost, UsageNotes, UsageTokens } from './RuntimeUsage';
import styles from './RuntimeStatistics.module.css';

/** 系统页按项目比较消耗；点项目名进入同一时间范围的项目页（项目页的人民币仍按该项目的费用可见性）。 */
export function RuntimeProjects({ period }: { period: RuntimePeriod }) {
  const t = useT(), query = useObservation(['projects'], period, (window) => api.observability.projects(window));
  const data = query.error ? undefined : query.data;
  return <Card title={t('runtime.projects')} footer={data?.truncated ? t('runtime.truncatedList', { count: countText(data.items.length) }) : t('runtime.projectsHint')}>
    <QueryStatus isPending={query.isPending} error={query.error} isEmpty={data?.items.length === 0} emptyTitle={t('runtime.empty')} />
    {data?.items.length ? <DataTable className={styles.table} columns={[t('runtime.column.project'), t('runtime.column.tasks'), t('runtime.column.calls'),
      t('runtime.column.tokens'), t('runtime.column.cost')]}>
      {data.items.map((row) => <tr key={row.projectId}>
        <td><RuntimeProjectLink projectId={row.projectId} search={{ period }}>{row.projectName ?? t('runtime.nameUnavailable')}</RuntimeProjectLink>
          <span className={styles.identity}>{row.projectId}</span></td>
        <td>{countText(row.tasks)}</td>
        <td>{countText(row.usage.calls)}<UsageNotes usage={row.usage} /></td>
        <td><UsageTokens usage={row.usage} /></td>
        <td><UsageCost usage={row.usage} /></td>
      </tr>)}
    </DataTable> : null}
  </Card>;
}
