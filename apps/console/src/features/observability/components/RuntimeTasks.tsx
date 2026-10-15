import type { AgentCallSource, ObservationTaskRow } from '@crewstation/contracts';
import { AGENT_CALL_SOURCES } from '@crewstation/contracts';
import { useState } from 'react';
import { api } from '../../../shared/api/client';
import { useDateText } from '../../../shared/lib/useDateText';
import { useT } from '../../../shared/lib/useT';
import { Badge } from '../../../shared/ui/Badge';
import { Card } from '../../../shared/ui/Card';
import { DataTable } from '../../../shared/ui/DataTable';
import { QueryStatus } from '../../../shared/ui/QueryStatus';
import { Segmented } from '../../../shared/ui/Segmented';
import { CatalogPagination } from '../../../shared/ui/catalog/CatalogPagination';
import { CatalogSearch } from '../../../shared/ui/catalog/CatalogSearch';
import { useObservation } from '../hooks/useObservation';
import { countText } from '../model/runtimeFormat';
import type { RuntimePeriod, RuntimeScope, RuntimeSearch } from '../model/runtimeSearch';
import { scopeProjectId } from '../model/runtimeSearch';
import { RuntimeTaskLink } from './RuntimeLinks';
import { UsageCost, UsageNotes, UsageTokens } from './RuntimeUsage';
import styles from './RuntimeStatistics.module.css';

interface TasksProps {
  readonly scope: RuntimeScope;
  readonly period: RuntimePeriod;
  readonly search: RuntimeSearch;
  readonly change: (search: RuntimeSearch) => void;
}

/** 按任务汇总（执行开始时间落在范围内）；关键词匹配展示名与任务 ID，来源分业务 / 开发 / 平台，键集分页每页 25。 */
export function RuntimeTasks({ scope, period, search, change }: TasksProps) {
  const t = useT(), projectId = scopeProjectId(scope), [cursor, setCursor] = useState<string>();
  const filter = [projectId ?? 'system', search.q ?? '', search.source ?? 'all'];
  const query = useObservation(['tasks', ...filter, cursor ?? ''], period, (window) => api.observability.tasks(projectId, {
    ...window, ...(search.q ? { q: search.q } : {}), ...(search.source ? { source: search.source } : {}), ...(cursor ? { cursor } : {}),
  }));
  const data = query.error ? undefined : query.data;
  const refine = (next: RuntimeSearch) => { setCursor(undefined); change(next); };
  const sources = AGENT_CALL_SOURCES.filter((source) => scope.kind === 'system' || source !== 'platform');
  return <Card stacked>
    <CatalogSearch value={search.q ?? ''} label={t('runtime.searchTasks')} onSearch={(q) => refine({ ...search, q: q || undefined })} />
    <Segmented label={t('runtime.column.source')} value={search.source ?? 'all'}
      items={[{ value: 'all', label: t('runtime.source.all') }, ...sources.map((source) => ({ value: source, label: t('runtime.source.' + source) }))]}
      onChange={(value) => refine({ ...search, source: value === 'all' ? undefined : value as AgentCallSource })} />
    <QueryStatus isPending={query.isPending} error={query.error} isEmpty={data?.items.length === 0} emptyTitle={t('runtime.emptyTasks')} />
    {data?.items.length ? <DataTable className={styles.table} columns={[t('runtime.column.task'), t('runtime.column.time'), t('runtime.column.agents'),
      t('runtime.column.calls'), t('runtime.column.tokens'), t('runtime.column.cost')]}>
      {data.items.map((row) => <TaskRow key={row.taskId} row={row} scope={scope} search={search} />)}
    </DataTable> : null}
    <CatalogPagination scope="runtime-tasks" filter={[...filter, period]} cursor={cursor} next={data?.nextCursor ?? undefined}
      count={data ? data.items.length : undefined} disabled={query.isPending || !!query.error} onChange={setCursor} />
  </Card>;
}

function TaskRow({ row, scope, search }: { row: ObservationTaskRow; scope: RuntimeScope; search: RuntimeSearch }) {
  const t = useT(), dateText = useDateText('second');
  return <tr data-runtime-task-id={row.taskId}>
    <td>
      <RuntimeTaskLink scope={scope} taskId={row.taskId} search={search}>{row.label}</RuntimeTaskLink>
      <span className={styles.identity}>{t('runtime.source.' + row.source)} · {row.taskId}</span>
    </td>
    <td>{dateText(row.firstStartedAt)}<span className={styles.identity}>{row.running ? <Badge tone="info">{t('runtime.status.running')}</Badge> : dateText(row.lastEndedAt ?? undefined)}</span></td>
    <td>{countText(row.agents)}</td>
    <td>{countText(row.usage.calls)}<UsageNotes usage={row.usage} /></td>
    <td><UsageTokens usage={row.usage} /></td>
    <td><UsageCost usage={row.usage} /></td>
  </tr>;
}
