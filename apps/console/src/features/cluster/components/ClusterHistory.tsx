import { useCallback, useState } from 'react';
import type { ClusterHistoryQuery, ClusterMetricName } from '@crewstation/contracts';
import { api } from '../../../shared/api/client';
import { queryKeys } from '../../../shared/api/queryKeys';
import { useApiQuery } from '../../../shared/api/useApi';
import { usePollingRefetch } from '../../../shared/lib/usePollingRefetch';
import { useT } from '../../../shared/lib/useT';
import { Card } from '../../../shared/ui/Card';
import { Button } from '../../../shared/ui/Button';
import { QueryStatus } from '../../../shared/ui/QueryStatus';
import { TimeSeries } from '../../../shared/ui/TimeSeries';
import { sameApartFromWindow } from '../model/clusterReads';
import { amount } from './MetricValue';
import styles from './Metrics.module.css';

const presets = { '1h': 3600, '6h': 21600, '24h': 86400, '7d': 604800 };
const localInput = (date: Date) => new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
export function ClusterHistory({ scope = 'cluster', resourceId, projectId, containers = [], device, networkInterface }: { scope?: ClusterHistoryQuery['scope']; resourceId?: string; projectId?: string; containers?: string[]; device?: string; networkInterface?: string }) {
  const t = useT(), [range, setRange] = useState('1h'), [container, setContainer] = useState(''), [metricSet, setMetricSet] = useState('usage');
  const [from, setFrom] = useState(() => localInput(new Date(Date.now() - 3600_000))), [to, setTo] = useState(() => localInput(new Date())), [stamp, setStamp] = useState(() => Date.now());
  const seconds = presets[range as keyof typeof presets], start = seconds ? stamp - seconds * 1000 : Date.parse(from), end = seconds ? stamp : Date.parse(to);
  const valid = Number.isFinite(start) && Number.isFinite(end) && start < end && end - start <= 7 * 86400_000 && start >= stamp - 7 * 86400_000 - 60_000 && end <= stamp + 30_000;
  const metrics: ClusterMetricName[] = device ? ['diskRead', 'diskWrite', 'diskReadOps', 'diskWriteOps'] : networkInterface ? ['networkRx', 'networkTx', 'networkRxErrors', 'networkTxErrors'] : scope === 'pvc' ? ['volumeUsed', 'storageRequested', 'storageCapacity'] : metricSet === 'requests' ? ['cpuRequested', 'memoryRequested', 'ephemeralRequested', ...(['cluster', 'node'].includes(scope) ? ['cpuCapacity', 'memoryCapacity', 'ephemeralCapacity'] as const : [])] : ['cpu', 'memory', ...(container ? ['ephemeralStorage'] as const : ['networkRx', 'networkTx'] as const), ...(['cluster', 'node'].includes(scope) ? ['fsUsed', 'fsAvailable'] as const : [])];
  const query: ClusterHistoryQuery = { scope: container ? 'container' : scope, resourceId, projectId, ...(container ? { container } : {}), ...(device ? { device } : {}), ...(networkInterface ? { interface: networkInterface } : {}), from: new Date(Number.isFinite(start) ? start : 0).toISOString(), to: new Date(Number.isFinite(end) ? end : 0).toISOString(), metrics };
  // 预设时间窗每分钟前移一次并重读，曲线原地替换；不再有「请求刷新」按钮（2026-09-23 裁定）。自定义时间窗固定不动。
  const advance = useCallback(() => setStamp(Date.now()), []);
  usePollingRefetch(advance, 60_000, !!seconds);
  const history = useApiQuery(queryKeys.cluster('history', query), () => api.cluster.history(query), { enabled: valid, keepPrevious: (previous) => sameApartFromWindow(previous, query) });
  return <div className={styles.stack}><div className={styles.controls}><label>{t('cluster.history.range')}<select value={range} onChange={(e) => { setRange(e.target.value); setStamp(Date.now()); }}>{Object.keys(presets).map((key) => <option key={key} value={key}>{t(`cluster.history.${key}`)}</option>)}<option value="custom">{t('cluster.history.custom')}</option></select></label>
    {range === 'custom' ? <><label>{t('cluster.history.from')}<input type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} /></label><label>{t('cluster.history.to')}<input type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} /></label></> : null}
    {scope !== 'pvc' && !device && !networkInterface ? <label>{t('cluster.history.metrics')}<select value={metricSet} onChange={(e) => setMetricSet(e.target.value)}><option value="usage">{t('cluster.metrics.actual')}</option><option value="requests">{t('cluster.metrics.requests')}</option></select></label> : null}
    {containers.length ? <label>{t('cluster.container')}<select value={container} onChange={(e) => setContainer(e.target.value)}><option value="">Pod</option>{containers.map((name) => <option key={name}>{name}</option>)}</select></label> : null}</div>
    <p className={styles.caption}>{t('cluster.history.retention')} · {Intl.DateTimeFormat().resolvedOptions().timeZone}</p>{!valid ? <p role="alert">{t('cluster.history.invalidRange')}</p> : null}
    {valid ? <QueryStatus isPending={history.isPending} error={history.error} /> : null}{history.data?.state === 'error' ? <p role="alert">{t('cluster.history.error')} · {history.data.reason}</p> : null}
    {valid && history.data?.state === 'fresh' ? <><p className={styles.caption}>{history.data.availableFrom ? t('cluster.history.availableFrom', { time: new Date(history.data.availableFrom).toLocaleString() }) : t('cluster.history.noData')} · {t('cluster.history.step', { seconds: history.data.stepSeconds })}</p><div className={styles.charts}>{history.data.series.map((series) => <TimeSeries key={series.metric} title={t(`cluster.metric.${series.metric}`)} points={series.points} format={(value) => amount(value, series.unit)} labels={{ average: t('cluster.history.average'), peak: t('cluster.history.peak'), coverage: t('cluster.history.coverage'), select: t('cluster.history.selectPoint'), gap: t('cluster.history.gap') }} />)}</div></> : null}
  </div>;
}
export function ClusterHistoryBrowser({ projectId }: { projectId?: string }) {
  const t = useT(), [selected, setSelected] = useState(projectId ? 'project' : 'cluster'), [q, setQ] = useState(''), [cursor, setCursor] = useState(0);
  const resources = useApiQuery(queryKeys.cluster('history-resources', [q, cursor, projectId]), () => api.cluster.historyResources({ q, cursor, projectId, limit: 100 }));
  const resource = resources.data?.items.find((r) => r.resourceId === selected), scope = resource ? resource.kind === 'Node' ? 'node' : resource.kind === 'Pod' ? 'pod' : 'pvc' : selected === 'system' ? 'system' : selected === 'project' && projectId ? 'project' : 'cluster';
  return <Card title={t('cluster.tab.history')} stacked><div className={styles.controls}><label>{t('cluster.search')}<input value={q} placeholder={t('cluster.history.search')} onChange={(e) => { setQ(e.target.value); setCursor(0); setSelected('cluster'); }} /></label><label>{t('cluster.resource')}<select value={selected} onChange={(e) => setSelected(e.target.value)}><option value="cluster">{t('cluster.metrics.global')}</option><option value="system">{t('cluster.system')}</option>{projectId ? <option value="project">{t('cluster.project')}</option> : null}{resources.data?.items.map((r) => <option key={r.resourceId} value={r.resourceId}>{r.kind} · {r.namespace}/{r.name}{r.deleted ? ` · ${t('cluster.history.deleted')}` : ''}</option>)}</select></label>{cursor ? <Button onClick={() => { setCursor(0); setSelected('cluster'); }}>{t('cluster.firstPage')}</Button> : null}{resources.data?.nextCursor !== undefined ? <Button onClick={() => { setCursor(resources.data!.nextCursor!); setSelected('cluster'); }}>{t('cluster.nextPage')}</Button> : null}</div><QueryStatus isPending={resources.isPending} error={resources.error} />{resource ? <p className={styles.code}>UID: {resource.uid} · {resource.deleted ? t('cluster.history.deleted') : t('cluster.history.present')}</p> : null}<ClusterHistory key={selected} scope={scope} resourceId={resource?.resourceId} projectId={scope === 'project' ? projectId : undefined} /></Card>;
}
