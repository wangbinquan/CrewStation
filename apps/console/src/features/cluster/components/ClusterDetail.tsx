import { useEffect, useRef, useState } from 'react';
import type { ClusterResource } from '@crewstation/contracts';
import { api } from '../../../shared/api/client';
import { queryKeys } from '../../../shared/api/queryKeys';
import { useApiQuery } from '../../../shared/api/useApi';
import { useT } from '../../../shared/lib/useT';
import { Card } from '../../../shared/ui/Card';
import { Tabs } from '../../../shared/ui/Tabs';
import { Button } from '../../../shared/ui/Button';
import { QueryStatus } from '../../../shared/ui/QueryStatus';
import { ClusterTable, Ownership } from './ClusterTable';
import { ClusterResourceMetrics } from './ClusterResourceMetrics';
import { ClusterActionPanel } from './ClusterActionPanel';
import { sameApartFromSnapshot } from '../model/clusterReads';
import styles from './Cluster.module.css';
export function ClusterDetail({ resourceId, snapshotId, close, select, onOperation }: { resourceId: string; snapshotId?: string; close: () => void; select: (row: ClusterResource) => void; onOperation: (id: string) => void }) {
  const t = useT(), [tab, setTab] = useState('overview');
  const request = { resourceId, snapshotId };
  // 换快照不重挂详情：清空会让面板塌成一行，随后 uid 再次出现又把焦点抢回来并滚动到面板。
  const detail = useApiQuery(queryKeys.cluster('detail', request), () => api.cluster.detail(resourceId, snapshotId), { keepPrevious: (previous) => sameApartFromSnapshot(previous, request) });
  const r = detail.data?.resource, panel = useRef<HTMLElement>(null);
  useEffect(() => { if (r?.uid) panel.current?.focus(); }, [r?.uid]);
  return <section ref={panel} tabIndex={-1} aria-label={t('cluster.detail')}><Card title={r?.name ?? t('cluster.detail')} extra={<Button onClick={close}>{t('cluster.close')}</Button>} className={styles.detail} stacked><QueryStatus isPending={detail.isPending} error={detail.error} />{r ? <>
    <p>{r.kind} · {r.namespace} · <Ownership row={r} /></p>
    {/* 操作放在详情顶部：概览很长，放在末尾要滚过整页才够得着；各页签都能直接操作。 */}
    <ClusterActionPanel row={r} onOperation={onOperation} />
    <Tabs label={t('cluster.detail')} value={tab} onChange={setTab} items={['overview', 'related', 'containers', 'events', ...(r.kind === 'Pod' ? ['logs', 'history'] : r.kind === 'PersistentVolumeClaim' ? ['history'] : [])].map((value) => ({ value, label: t(`cluster.detail.${value}`) }))}>
      {tab === 'overview' ? <div className={styles.stack}><dl className={styles.facts}>{Object.entries({ UID: r.uid, [t('cluster.purpose')]: t(`cluster.purpose.${r.purpose}`), [t('cluster.status')]: r.phase, [t('cluster.ready')]: r.ready ? t('cluster.yes') : t('cluster.no'), [t('cluster.reason')]: r.reason || '—', ...r.facts, ...(r.taskId ? { taskId: r.taskId } : {}), ...(r.parentTaskId ? { parentTaskId: r.parentTaskId } : {}), ...(r.agentId ? { agentId: r.agentId } : {}), ...(r.releaseId ? { releaseId: r.releaseId } : {}), ...(r.profile ? { [t('cluster.profile')]: `${r.profile}${r.profileRevision === undefined ? '' : ` @${r.profileRevision}`}` } : {}), [t('cluster.observed')]: new Date(r.observedAt).toLocaleString() }).map(([key, value]) => <Pair key={key} label={key} value={value} />)}</dl><ClusterResourceMetrics resource={r} view="overview" /></div> : null}
      {tab === 'related' ? <><p>{r.owners.map((o) => `${o.kind}/${o.name} (${o.uid})`).join(', ') || t('cluster.noOwner')}</p><ClusterTable rows={detail.data!.related} select={select} /></> : null}
      {tab === 'containers' ? <ClusterResourceMetrics resource={r} view="containers" /> : null}
      {tab === 'history' ? <ClusterResourceMetrics resource={r} view="history" /> : null}
      {tab === 'events' ? <ResourceEvents id={r.resourceId} /> : null}{tab === 'logs' ? <ResourceLogs row={r} /> : null}
    </Tabs>
  </> : null}</Card></section>;
}
function Pair({ label, value }: { label: string; value: string }) { return <><dt>{label}</dt><dd>{value}</dd></>; }
function ResourceEvents({ id }: { id: string }) {
  const t = useT(), query = useApiQuery(queryKeys.cluster('events', id), () => api.cluster.events(id));
  return <div className={styles.stack}><QueryStatus isPending={query.isPending} error={query.error} isEmpty={query.data?.items.length === 0} emptyTitle={t('cluster.noEvents')} />{query.data?.items.map((e) => <article key={e.uid}><strong>{e.type} · {e.reason} ×{e.count}</strong><p>{e.message}</p><small>{e.at ?? '—'}</small></article>)}</div>;
}
function ResourceLogs({ row }: { row: ClusterResource }) {
  const t = useT(), [container, setContainer] = useState(row.containers[0]?.name ?? ''), [previous, setPrevious] = useState(false);
  const query = useApiQuery(queryKeys.cluster('logs', [row.uid, container, previous]), () => api.cluster.logs(row.resourceId, { container, previous: previous ? 'true' : 'false', tailLines: 500 }), { enabled: !!container });
  return <div className={styles.stack}><div className={styles.filters}><label>{t('cluster.container')}<select value={container} onChange={(e) => setContainer(e.target.value)}>{row.containers.map((c) => <option key={c.name} value={c.name}>{c.init ? 'init · ' : ''}{c.name}</option>)}</select></label><label><span>{t('cluster.previous')}</span><input type="checkbox" checked={previous} onChange={(e) => setPrevious(e.target.checked)} /></label></div><p className={styles.muted}>{t('cluster.logLimit')}</p><QueryStatus isPending={query.isPending} error={query.error} /><pre className={styles.log}>{query.data?.text || (!query.isPending && !query.error ? t('cluster.noLogs') : '')}</pre>{query.data?.truncated ? <p>{t('cluster.truncated')}</p> : null}</div>;
}
