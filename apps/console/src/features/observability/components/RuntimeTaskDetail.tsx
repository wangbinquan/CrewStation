import type { ObservationTaskDetail } from '@crewstation/contracts';
import { AGENT_CALL_STATUSES } from '@crewstation/contracts';
import { useSearch } from '@tanstack/react-router';
import { api } from '../../../shared/api/client';
import { AUTO_REFRESH, useApiQuery } from '../../../shared/api/useApi';
import { useT } from '../../../shared/lib/useT';
import { Card } from '../../../shared/ui/Card';
import { PageHeader } from '../../../shared/ui/PageHeader';
import { QueryStatus } from '../../../shared/ui/QueryStatus';
import { Stack } from '../../../shared/ui/Stack';
import { MetricTile } from '../../../shared/ui/metrics/MetricTile';
import { callDurationMs, countText, durationText, tokenText, tokenTotal, usageCostText } from '../model/runtimeFormat';
import type { RuntimeScope } from '../model/runtimeSearch';
import { parseRuntimeSearch, scopeProjectId } from '../model/runtimeSearch';
import { RuntimeCallLanes } from './RuntimeCallLanes';
import { RuntimeCallTable } from './RuntimeCallTable';
import { RuntimeBackLink } from './RuntimeLinks';
import { TokenBucketList, UsageNotes } from './RuntimeUsage';
import styles from './RuntimeStatistics.module.css';

/** 任务详情（独立路由）：汇总、执行泳道与执行表；运行中每 30 秒在原位刷新。 */
export function RuntimeTaskDetail({ scope, taskId }: { scope: RuntimeScope; taskId: string }) {
  const t = useT(), search = parseRuntimeSearch(useSearch({ strict: false })), projectId = scopeProjectId(scope);
  const query = useApiQuery(['runtime-observation', 'task', projectId ?? 'system', taskId], () => api.observability.task(projectId, taskId), AUTO_REFRESH);
  const data = query.error ? undefined : query.data;
  return <Stack className={styles.page} data-runtime-task={taskId}>
    <PageHeader title={data?.task.label ?? t('runtime.task')} description={data ? `${t('runtime.source.' + data.task.source)} · ${taskId}` : taskId}
      actions={<RuntimeBackLink scope={scope} search={search}>{t('runtime.back')}</RuntimeBackLink>} />
    <QueryStatus isPending={query.isPending} error={query.error} />
    {data ? <>
      <TaskSummary data={data} />
      {data.truncated ? <p role="status" className={styles.notice}>{t('runtime.truncated', { count: countText(data.calls.length) })}</p> : null}
      <RuntimeCallLanes calls={data.calls} asOf={data.asOf} costVisible={data.costVisible} />
      <Card title={t('runtime.calls')}><RuntimeCallTable calls={data.calls} asOf={data.asOf} costVisible={data.costVisible} /></Card>
    </> : null}
  </Stack>;
}

function TaskSummary({ data }: { data: ObservationTaskDetail }) {
  const t = useT(), usage = data.usage, lowerBound = usage.incompleteCalls > 0;
  const starts = data.calls.map((call) => Date.parse(call.startedAt)), ends = data.calls.map((call) => Date.parse(call.startedAt) + callDurationMs(call, data.asOf));
  const elapsed = starts.length ? Math.max(...ends) - Math.min(...starts) : null;
  const statuses = AGENT_CALL_STATUSES.map((status) => [status, data.calls.filter((call) => call.status === status).length] as const).filter(([, count]) => count > 0);
  return <div className={styles.tiles}>
    <MetricTile title={t('runtime.tile.tokens')} value={tokenText(tokenTotal(usage), lowerBound)}><TokenBucketList usage={usage} lowerBound={lowerBound} /></MetricTile>
    <MetricTile title={t('runtime.tile.cost')} value={data.costVisible ? usageCostText(usage, t) : '—'}>
      <p className={styles.hint}>{t(data.costVisible ? 'runtime.costHint' : 'runtime.costHidden')}</p>
      <UsageNotes usage={usage} />
    </MetricTile>
    <MetricTile title={t('runtime.tile.calls')} value={countText(usage.calls)}>
      <dl className={styles.tokenBuckets}>{statuses.map(([status, count]) => <div key={status}><dt>{t('runtime.status.' + status)}</dt><dd>{countText(count)}</dd></div>)}</dl>
    </MetricTile>
    <MetricTile title={t('runtime.tile.elapsed')} value={durationText(elapsed)} hint={t('runtime.elapsedHint')} />
  </div>;
}
