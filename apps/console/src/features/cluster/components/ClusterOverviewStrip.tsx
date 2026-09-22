import type { ReactElement } from 'react';
import type { ClusterSummary } from '@crewstation/contracts';
import { api } from '../../../shared/api/client';
import { queryKeys } from '../../../shared/api/queryKeys';
import { useApiQuery } from '../../../shared/api/useApi';
import { useT } from '../../../shared/lib/useT';
import { Button } from '../../../shared/ui/Button';
import { QueryStatus } from '../../../shared/ui/QueryStatus';
import type { ClusterSearch } from '../model/clusterSearch';
import { CapacityDetails, CapacityTiles } from './ClusterCapacity';
import styles from './Cluster.module.css';

interface Props {
  readonly summary?: ClusterSummary;
  readonly pending: boolean;
  readonly error: unknown;
  /** 摘要用的快照已过期：给一个读取最新快照的入口。 */
  readonly expired: boolean;
  readonly newSnapshot: () => void;
  /** 点计数格：进「资源清单」的对应视图，带上该格的筛选。 */
  readonly select: (patch: ClusterSearch) => void;
}

const COUNTS: readonly { readonly key: 'workloads' | 'pods' | 'services' | 'pvcs' | 'abnormal'; readonly patch: ClusterSearch }[] = [
  { key: 'workloads', patch: { tab: 'workloads' } }, { key: 'pods', patch: { tab: 'pods' } }, { key: 'services', patch: { tab: 'network', kind: 'Service' } },
  { key: 'pvcs', patch: { tab: 'storage', kind: 'PersistentVolumeClaim' } }, { key: 'abnormal', patch: { tab: 'pods', status: 'abnormal' } },
];

/** 顶部指标条（2026-09-23 裁定）：集群容量五格＋受管资源计数五格一行，窄屏两组各自换行；采集状态与明细在下面一行折叠。 */
export function ClusterOverviewStrip({ summary: s, pending, error, expired, newSnapshot, select }: Props): ReactElement {
  const t = useT(), capacity = useApiQuery(queryKeys.cluster('capacity'), () => api.cluster.capacity(), { refetchIntervalMs: 15_000, refetchOnWindowFocus: true });
  const c = capacity.data;
  return <section className={styles.overview} aria-label={t('cluster.overview')}>
    <div className={styles.strip}>
      <div className={`${styles.group} ${styles.capacityGroup}`}><p className={styles.groupTitle}>{t('cluster.capacityGroup')}</p>{c ? <div className={styles.tiles}><CapacityTiles data={c} /></div> : <QueryStatus isPending={capacity.isPending} error={capacity.error} />}</div>
      <div className={`${styles.group} ${styles.countGroup}`}><p className={styles.groupTitle}>{t('cluster.managed')}</p><div className={styles.tiles}>
        {COUNTS.map(({ key, patch }) => <button type="button" key={key} className={key === 'abnormal' && (s?.abnormal ?? 0) > 0 ? `${styles.tile} ${styles.tileDanger}` : styles.tile} onClick={() => select({ kind: undefined, status: undefined, purpose: undefined, ...patch })}>
          <span className={styles.tileTitle}>{t(`cluster.count.${key}`)}</span><strong className={styles.hero}>{s ? !s.complete && s[key] === 0 ? '—' : s[key] : '—'}</strong>
          {key === 'pods' && s ? <small>{t('cluster.podCounts', { running: s.runningPods, ready: s.readyPods })}</small> : null}
        </button>)}
      </div></div>
    </div>
    <QueryStatus isPending={pending} error={error} />{expired ? <Button onClick={newSnapshot}>{t('cluster.newSnapshot')}</Button> : null}
    {s || c ? <div className={`${styles.status} ${s && !s.complete ? styles.warning : styles.muted}`}>
      <p>{s ? `${s.complete ? t('cluster.complete') : t('cluster.partial')} · ${t('cluster.observed')} ${new Date(s.finishedAt).toLocaleString()}` : null}{s && c ? ' · ' : null}{c ? t('cluster.metrics.capacityObserved', { time: new Date(c.observedAt).toLocaleString(), state: t(`cluster.metricState.${c.state}`) }) : null}</p>
      <details><summary>{t('cluster.strip.more')}</summary>
        {s ? <><h3>{t('cluster.sources')}</h3>{s.sources.map((source) => <p key={source.key}>{source.namespace || '*'} / {source.kind} · {t(`cluster.source.${source.state}`)} · {source.state === 'error' || source.state === 'unsupported' ? '—' : source.count}{source.reason ? ` · ${source.reason}` : ''}</p>)}</> : null}
        {c ? <CapacityDetails data={c} /> : null}
      </details>
    </div> : null}
  </section>;
}
