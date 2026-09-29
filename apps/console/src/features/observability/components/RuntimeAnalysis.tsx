import { useRef, type RefObject } from 'react';
import type { RuntimeStatistics, RuntimeTaskSummary } from '@crewstation/contracts';
import { useT } from '../../../shared/lib/useT';
import { Stack } from '../../../shared/ui/Stack';
import { Card } from '../../../shared/ui/Card';
import { Button } from '../../../shared/ui/Button';
import { DataTable } from '../../../shared/ui/DataTable';
import { Dialog } from '../../../shared/ui/dialog/Dialog';
import { EmptyState } from '../../../shared/ui/EmptyState';
import { RuntimeMetrics, RuntimeTokenBuckets } from './RuntimeMetrics';
import { runtimeCny, runtimeTokens, runtimeDuration, runtimeDate } from '../model/runtimeFormat';
import type { RuntimeSearch } from '../model/runtimeSearch';
import styles from './RuntimeStatistics.module.css';
interface Props { data: RuntimeStatistics; search: RuntimeSearch; change: (search: RuntimeSearch) => void; task: (id: string) => void }
function TaskTable({ tasks, open }: { tasks: RuntimeTaskSummary[]; open: (id: string) => void }) {
  const t = useT(); if (!tasks.length) return <EmptyState title={t('runtime.empty')} description={t('runtime.emptyHint')} />;
  return <DataTable className={styles.table} columns={['task', 'project', 'state', 'attempts', 'tokens', 'cost', 'wall'].map((k) => t('runtime.' + k))}>
    {tasks.map((row) => <tr key={row.id} data-runtime-task-id={row.id}><td><Button size="small" variant="ghost" onClick={() => open(row.id)}>{row.name}</Button><span className={styles.identity}>{row.id}</span></td><td>{row.projectName ?? t('runtime.nameUnavailable')}<span className={styles.identity}>{row.projectId}</span></td><td>{t('runtime.state.' + row.state)}</td><td>{row.attemptCount}</td><td>{runtimeTokens(row.metrics)}</td><td>{runtimeCny(row.metrics)}</td><td>{runtimeDuration(row.wallMs)}</td></tr>)}
  </DataTable>;
}
function Trend({ data, change, search }: Pick<Props, 'data' | 'change' | 'search'>) {
  const t = useT(), max = data.trend.reduce((max, row) => row.metrics.tokens.hasKnown && BigInt(row.metrics.tokens.total) > max ? BigInt(row.metrics.tokens.total) : max, 1n);
  return <Card title={t('runtime.trend')} footer={t('runtime.trendHint')} stacked>
    <div className={styles.scroll}><div className={styles.chart} role="group" aria-label={t('runtime.trend')}>{data.trend.map((row) => <button key={row.from} type="button" className={styles.chartColumn}
      aria-label={`${runtimeDate(row.from, data.filters.timezone)} · ${runtimeTokens(row.metrics)} Token · ${row.tasks} ${t('runtime.tasks')}`}
      title={`${runtimeDate(row.from, data.filters.timezone)} — ${runtimeDate(row.to, data.filters.timezone)} · ${runtimeTokens(row.metrics)} Token`}
      onClick={() => change({ ...search, from: row.from, to: row.to, tab: 'tasks' })}>
      <span className={styles.chartValue} aria-hidden="true">{runtimeTokens(row.metrics)}</span>
      <span className={styles.chartTrack} aria-hidden="true">{row.metrics.tokens.hasKnown && BigInt(row.metrics.tokens.total) > 0n ? <span className={styles.chartBar} style={{ height: `${Math.max(1, Number(BigInt(row.metrics.tokens.total) * 10000n / max) / 100)}%` }} /> : null}</span>
    </button>)}</div></div><div className={styles.range}><span>{runtimeDate(data.filters.from, data.filters.timezone)}</span><span>{runtimeDate(data.filters.to, data.filters.timezone)}</span></div>
  </Card>;
}
function Usage({ data, search, change, opener }: Pick<Props, 'data' | 'search' | 'change'> & { opener: RefObject<HTMLButtonElement | null> }) {
  const t = useT(); return <Stack>
    <Card title={t('runtime.buckets')}><RuntimeTokenBuckets metrics={data.metrics} /></Card>
    <Card title={t('runtime.profiles')} footer={t('runtime.profileHint')}><DataTable columns={[t('runtime.profile'), t('runtime.tasks'), t('runtime.tokens'), t('runtime.cost')]}>{data.profiles.map((r) => <tr key={r.key}>
      <td><Button ref={(node) => { if (node && r.key === search.profile) opener.current = node; }} size="small" onClick={() => change({ ...search, profile: r.key, agent: undefined })}>{r.profileName ?? t('runtime.nameUnavailable')} · r{r.profileRevision ?? '—'}</Button><span className={styles.identity}>{r.profileId ?? t('runtime.unknown')}</span></td>
      <td>{r.tasks.length}</td><td>{runtimeTokens(r.metrics)}</td><td>{runtimeCny(r.metrics)}</td></tr>)}</DataTable></Card>
    {data.scope === 'system' ? <Card title={t('runtime.models')} footer={t('runtime.modelHint')}><DataTable columns={[t('runtime.model'), t('runtime.tokens'), t('runtime.cost')]}>{data.models.map((r) => <tr key={r.modelRef ?? 'unknown'}><td className={styles.identity}>{r.modelRef ?? t('runtime.unknown')}</td><td>{runtimeTokens(r.metrics)}</td><td>{runtimeCny(r.metrics)}</td></tr>)}</DataTable></Card> : null}
    <Card title={t('runtime.pricingSource')}><p>{t(data.scope === 'system' ? 'runtime.systemPricing' : 'runtime.projectPricing')}</p></Card>
  </Stack>;
}
function Contributions({ rows, data, open }: { rows: RuntimeStatistics['profiles'][number]['tasks']; data: RuntimeStatistics; open: (id: string) => void }) {
  const t = useT(); return <DataTable columns={['task', 'project', 'attempts', 'tokens', 'cost'].map((k) => t('runtime.' + k))}>{rows.map((row) => {
    const task = data.tasks.find((x) => x.id === row.taskId);
    return <tr key={row.taskId}><td><Button size="small" onClick={() => open(row.taskId)}>{task?.name ?? row.taskId}</Button></td><td>{task?.projectName ?? t('runtime.nameUnavailable')}</td><td>{row.attempts}</td><td>{runtimeTokens(row.metrics)}</td><td>{runtimeCny(row.metrics)}</td></tr>;
  })}</DataTable>;
}
function Performance({ data, search, change }: Pick<Props, 'data' | 'search' | 'change'>) {
  const t = useT(); return <Stack><div className={styles.grid}>
    {(['p50Ms', 'p95Ms', 'maxMs'] as const).map((key) => <Card title={t('runtime.' + key)} key={key}><p className={styles.value}>{runtimeDuration(data.durations[key])}</p><p className={styles.hint}>{t('runtime.samples', { count: data.durations.samples })}</p></Card>)}
    </div><Card title={t('runtime.quality')} footer={t('runtime.qualityHint')}><DataTable columns={[t('runtime.reason'), t('runtime.tasks')]}>{data.quality.map((row) => <tr key={row.reason}><td>{t('runtime.reason.' + row.reason)}</td><td><Button size="small" onClick={() => change({ ...search, tab: 'tasks', quality: row.reason })}>{row.taskIds.length}</Button></td></tr>)}</DataTable></Card></Stack>;
}
export function RuntimeAnalysis({ data, search, change, task }: Props) {
  const t = useT(), tab = search.tab ?? 'overview', profileOpener = useRef<HTMLButtonElement>(null), agentOpener = useRef<HTMLButtonElement>(null);
  const rows = data.tasks.filter((row) => (!search.q || `${row.name} ${row.id} ${row.projectName ?? ''} ${row.projectId}`.toLowerCase().includes(search.q.toLowerCase())) && (!search.state || row.state === search.state) && (!search.quality || row.metrics.reasons.includes(search.quality)));
  const selected = search.agent ? data.agents.find((a) => a.key === search.agent) : undefined;
  const profile = search.profile ? data.profiles.find((p) => p.key === search.profile) : undefined;
  return <>
    {tab === 'overview' ? <Stack><RuntimeMetrics metrics={data.metrics} tasks={data.tasks.length} /><Trend data={data} change={change} search={search} />
      {data.scope === 'system' ? <Card title={t('runtime.projects')}><DataTable columns={[t('runtime.project'), t('runtime.tasks'), t('runtime.tokens'), t('runtime.cost')]}>{data.projects.map((p) => <tr key={p.projectId}><td><Button size="small" variant="ghost" onClick={() => change({ ...search, tab: 'usage', q: p.projectId })}>{p.projectName ?? t('runtime.nameUnavailable')}</Button><span className={styles.identity}>{p.projectId}</span></td><td>{p.tasks}</td><td>{runtimeTokens(p.metrics)}</td><td>{runtimeCny(p.metrics)}</td></tr>)}</DataTable></Card> : null}
      <Card title={t('runtime.recent')}><TaskTable tasks={rows.slice(0, 8)} open={task} /></Card></Stack> : null}
    {tab === 'tasks' ? <Card title={t('runtime.tasks')} footer={search.quality ? t('runtime.reason.' + search.quality) : undefined}><TaskTable tasks={rows} open={task} /></Card> : null}
    {tab === 'agents' ? <Card title={t('runtime.agents')} footer={t('runtime.agentHint')}><DataTable columns={['agent', 'tasks', 'executions', 'tokens', 'cost'].map((key) => t('runtime.' + key))}>{data.agents.map((a) => <tr key={a.key}><td><Button ref={(node) => { if (node && a.key === search.agent) agentOpener.current = node; }} size="small" variant="ghost" onClick={() => change({ ...search, agent: a.key, profile: undefined })}>{a.name}</Button><span className={styles.identity}>{a.profileName ?? t('runtime.nameUnavailable')} · r{a.profileRevision ?? '—'}</span></td><td>{a.tasks.length}</td><td>{a.metrics.executions}</td><td>{runtimeTokens(a.metrics)}</td><td>{runtimeCny(a.metrics)}</td></tr>)}</DataTable></Card> : null}
    {tab === 'usage' ? <Usage data={data} search={search} change={change} opener={profileOpener} /> : null}{tab === 'performance' ? <Performance data={data} search={search} change={change} /> : null}
    {selected ? <Dialog title={selected.name} returnFocusTo={agentOpener} size="large" onClose={() => change({ ...search, agent: undefined })}><Stack><RuntimeMetrics metrics={selected.metrics} tasks={selected.tasks.length} /><RuntimeTokenBuckets metrics={selected.metrics} />
      <dl className={styles.facts}><dt>{t('runtime.project')}</dt><dd>{selected.projectName ?? t('runtime.nameUnavailable')}</dd><dt>{t('runtime.profile')}</dt><dd>{selected.profileName ?? t('runtime.nameUnavailable')} · r{selected.profileRevision ?? '—'}</dd></dl>
      <Contributions rows={selected.tasks} data={data} open={task} /></Stack></Dialog> : null}
    {profile ? <Dialog returnFocusTo={profileOpener} title={(profile.profileName ?? t('runtime.nameUnavailable')) + ' · r' + (profile.profileRevision ?? '—')} size="large" onClose={() => change({ ...search, profile: undefined })}><Stack>
      <RuntimeMetrics metrics={profile.metrics} tasks={profile.tasks.length} /><RuntimeTokenBuckets metrics={profile.metrics} /><Contributions rows={profile.tasks} data={data} open={task} />
    </Stack></Dialog> : null}
  </>;
}
