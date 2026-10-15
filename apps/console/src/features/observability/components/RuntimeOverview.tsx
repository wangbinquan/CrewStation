import type { AgentCallSource, ObservationOverview } from '@crewstation/contracts';
import { AGENT_CALL_SOURCES, AGENT_CALL_STATUSES } from '@crewstation/contracts';
import { api } from '../../../shared/api/client';
import { useT } from '../../../shared/lib/useT';
import { Card } from '../../../shared/ui/Card';
import { DataTable } from '../../../shared/ui/DataTable';
import { EmptyState } from '../../../shared/ui/EmptyState';
import { QueryStatus } from '../../../shared/ui/QueryStatus';
import { Stack } from '../../../shared/ui/Stack';
import { MetricTile } from '../../../shared/ui/metrics/MetricTile';
import { useObservation } from '../hooks/useObservation';
import { countText, durationText, tokenText, tokenTotal, usageCostText } from '../model/runtimeFormat';
import type { RuntimePeriod, RuntimeScope, RuntimeSearch } from '../model/runtimeSearch';
import { scopeProjectId } from '../model/runtimeSearch';
import { RuntimeDailyChart } from './RuntimeDailyChart';
import { RuntimeProjectLink, RuntimeTaskLink } from './RuntimeLinks';
import { TokenBucketList, UsageCost, UsageNotes, UsageTokens } from './RuntimeUsage';
import styles from './RuntimeStatistics.module.css';

interface OverviewProps { readonly scope: RuntimeScope; readonly period: RuntimePeriod; readonly search: RuntimeSearch }

/** 总览：Token、人民币、执行情况、时长四张卡，按天柱图，来源拆分，Token 最多的任务与 Agent（系统页另含项目）。 */
export function RuntimeOverview({ scope, period, search }: OverviewProps) {
  const projectId = scopeProjectId(scope);
  const query = useObservation(['overview', projectId ?? 'system'], period, (window) => api.observability.overview(projectId, window));
  const data = query.error ? undefined : query.data;
  return <Stack data-runtime-overview="">
    <QueryStatus isPending={query.isPending} error={query.error} />
    {data ? <>
      <OverviewTiles data={data} />
      <RuntimeDailyChart daily={data.daily} costVisible={data.costVisible} />
      <SourceSplit data={data} system={scope.kind === 'system'} />
      <div className={styles.grid}>
        <TopTasks data={data} scope={scope} search={search} />
        <TopAgents data={data} />
      </div>
      {scope.kind === 'system' ? <TopProjects data={data} period={period} /> : null}
    </> : null}
  </Stack>;
}

function OverviewTiles({ data }: { data: ObservationOverview }) {
  const t = useT(), usage = data.usage, lowerBound = usage.incompleteCalls > 0, { durations, statuses } = data;
  return <div className={styles.tiles}>
    <MetricTile title={t('runtime.tile.tokens')} value={tokenText(tokenTotal(usage), lowerBound)} hint={t('runtime.tokenHint')}>
      <TokenBucketList usage={usage} lowerBound={lowerBound} />
    </MetricTile>
    <MetricTile title={t('runtime.tile.cost')} value={data.costVisible ? usageCostText(usage, t) : '—'}>
      <p className={styles.hint}>{t(data.costVisible ? 'runtime.costHint' : 'runtime.costHidden')}</p>
      <UsageNotes usage={usage} />
    </MetricTile>
    <MetricTile title={t('runtime.tile.calls')} value={countText(usage.calls)}>
      <dl className={styles.tokenBuckets}>
        {AGENT_CALL_STATUSES.map((status) => <div key={status}><dt>{t('runtime.status.' + status)}</dt><dd>{countText(statuses[status])}</dd></div>)}
      </dl>
    </MetricTile>
    <MetricTile title={t('runtime.tile.duration')} value={durationText(durations.p50)} hint={t('runtime.durationHint')}>
      <dl className={styles.tokenBuckets}>
        <div><dt>P50</dt><dd>{durationText(durations.p50)}</dd></div>
        <div><dt>P95</dt><dd>{durationText(durations.p95)}</dd></div>
        <div><dt>{t('runtime.durationMax')}</dt><dd>{durationText(durations.max)}</dd></div>
        <div><dt>{t('runtime.durationSamples')}</dt><dd>{countText(durations.samples)}</dd></div>
      </dl>
    </MetricTile>
  </div>;
}

/** 业务、开发与平台执行各自的消耗；项目页没有平台执行。 */
function SourceSplit({ data, system }: { data: ObservationOverview; system: boolean }) {
  const t = useT(), sources = AGENT_CALL_SOURCES.filter((source) => system || source !== 'platform');
  return <Card title={t('runtime.bySource')} footer={t('runtime.bySourceHint')}>
    <DataTable columns={[t('runtime.column.source'), t('runtime.column.calls'), t('runtime.column.tokens'), t('runtime.column.cost')]}>
      {sources.map((source: AgentCallSource) => <tr key={source} data-runtime-source={source}>
        <td>{t('runtime.source.' + source)}<UsageNotes usage={data.bySource[source]} /></td>
        <td>{countText(data.bySource[source].calls)}</td>
        <td><UsageTokens usage={data.bySource[source]} /></td>
        <td><UsageCost usage={data.bySource[source]} /></td>
      </tr>)}
    </DataTable>
  </Card>;
}

function TopTasks({ data, scope, search }: { data: ObservationOverview; scope: RuntimeScope; search: RuntimeSearch }) {
  const t = useT();
  return <Card title={t('runtime.topTasks')}>
    {data.topTasks.length ? <DataTable columns={[t('runtime.column.task'), t('runtime.column.tokens'), t('runtime.column.cost')]}>
      {data.topTasks.map((row) => <tr key={row.taskId}>
        <td><RuntimeTaskLink scope={scope} taskId={row.taskId} search={search}>{row.label}</RuntimeTaskLink><span className={styles.identity}>{t('runtime.source.' + row.source)}</span></td>
        <td><UsageTokens usage={row.usage} /></td>
        <td><UsageCost usage={row.usage} /></td>
      </tr>)}
    </DataTable> : <EmptyState title={t('runtime.empty')} />}
  </Card>;
}

function TopAgents({ data }: { data: ObservationOverview }) {
  const t = useT();
  return <Card title={t('runtime.topAgents')}>
    {data.topAgents.length ? <DataTable columns={[t('runtime.column.agent'), t('runtime.column.tokens'), t('runtime.column.cost')]}>
      {data.topAgents.map((row) => <tr key={row.agentKey}>
        <td>{row.agentLabel}<span className={styles.identity}>{t('runtime.agentTasks', { count: countText(row.tasks) })}</span></td>
        <td><UsageTokens usage={row.usage} /></td>
        <td><UsageCost usage={row.usage} /></td>
      </tr>)}
    </DataTable> : <EmptyState title={t('runtime.empty')} />}
  </Card>;
}

function TopProjects({ data, period }: { data: ObservationOverview; period: RuntimePeriod }) {
  const t = useT();
  return <Card title={t('runtime.topProjects')}>
    {data.topProjects.length ? <DataTable columns={[t('runtime.column.project'), t('runtime.column.tasks'), t('runtime.column.tokens'), t('runtime.column.cost')]}>
      {data.topProjects.map((row) => <tr key={row.projectId}>
        <td><RuntimeProjectLink projectId={row.projectId} search={{ period }}>{row.projectName ?? t('runtime.nameUnavailable')}</RuntimeProjectLink></td>
        <td>{countText(row.tasks)}</td>
        <td><UsageTokens usage={row.usage} /></td>
        <td><UsageCost usage={row.usage} /></td>
      </tr>)}
    </DataTable> : <EmptyState title={t('runtime.empty')} />}
  </Card>;
}
