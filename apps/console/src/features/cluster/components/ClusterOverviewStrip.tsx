import { useId } from 'react';
import type { ReactElement } from 'react';
import { Link } from '@tanstack/react-router';
import { ClusterCapacitySchema, ClusterSummarySchema } from '@crewstation/contracts';
import { api } from '../../../shared/api/client';
import { queryKeys } from '../../../shared/api/queryKeys';
import { useApiQuery } from '../../../shared/api/useApi';
import { useT } from '../../../shared/lib/useT';
import { QueryStatus } from '../../../shared/ui/QueryStatus';
import type { ClusterSearch } from '../model/clusterSearch';
import { clusterFilter, parseClusterSearch } from '../model/clusterSearch';
import { CapacityDetails, CapacityTiles } from './ClusterCapacity';
import styles from './Cluster.module.css';

const COUNTS: readonly { readonly key: 'workloads' | 'pods' | 'services' | 'pvcs' | 'abnormal'; readonly search: ClusterSearch }[] = [
  { key: 'workloads', search: { tab: 'workloads' } }, { key: 'pods', search: { tab: 'pods' } }, { key: 'services', search: { tab: 'network', kind: 'Service' } },
  { key: 'pvcs', search: { tab: 'storage', kind: 'PersistentVolumeClaim' } }, { key: 'abnormal', search: { tab: 'pods', status: 'abnormal' } },
];

/**
 * 集群状态条（2026-09-23 作者裁定从集群管理挪到管理总览最上面）：集群容量五格＋受管资源计数五格一行，窄屏两组各自换行；
 * 采集状态与明细在下面一行折叠。计数是整个集群、不带筛选的；点计数格进集群管理「资源清单」的对应视图并带上该格的筛选。
 */
export function ClusterOverviewStrip(): ReactElement {
  const t = useT(), heading = useId(), filter = clusterFilter(parseClusterSearch({}));
  // 总览是管理空间的落地页：回执先过契约检查，缺字段按读取失败显示，不让整页在 `.sources` 上崩掉（同项目形态页）。
  // 与集群管理页不带筛选时同一个查询键：从总览点进去，拓扑与清单直接用上这份摘要。
  const summary = useApiQuery(queryKeys.cluster('summary', filter), async () => { const parsed = ClusterSummarySchema.safeParse(await api.cluster.summary(filter)); if (!parsed.success) throw new Error(t('cluster.invalidResponse')); return parsed.data; }, { refetchIntervalMs: 15_000, refetchOnWindowFocus: true });
  const capacity = useApiQuery(queryKeys.cluster('capacity'), async () => { const parsed = ClusterCapacitySchema.safeParse(await api.cluster.capacity()); if (!parsed.success) throw new Error(t('cluster.invalidResponse')); return parsed.data; }, { refetchIntervalMs: 15_000, refetchOnWindowFocus: true });
  const s = summary.data, c = capacity.data;
  return <section className={styles.overview} aria-labelledby={heading}>
    <h2 className={styles.overviewTitle} id={heading}>{t('cluster.overview')}</h2>
    <div className={styles.strip}>
      <div className={`${styles.group} ${styles.capacityGroup}`}><p className={styles.groupTitle}>{t('cluster.capacityGroup')}</p>{c ? <div className={styles.tiles}><CapacityTiles data={c} /></div> : <QueryStatus isPending={capacity.isPending} error={capacity.error} />}</div>
      <div className={`${styles.group} ${styles.countGroup}`}><p className={styles.groupTitle}>{t('cluster.managed')}</p><div className={styles.tiles}>
        {COUNTS.map(({ key, search }) => <Link key={key} to="/admin/cluster" search={search} className={key === 'abnormal' && (s?.abnormal ?? 0) > 0 ? `${styles.tile} ${styles.tileDanger}` : styles.tile}>
          <span className={styles.tileTitle}>{t(`cluster.count.${key}`)}</span><strong className={styles.hero}>{s ? !s.complete && s[key] === 0 ? '—' : s[key] : '—'}</strong>
          {key === 'pods' && s ? <small>{t('cluster.podCounts', { running: s.runningPods, ready: s.readyPods })}</small> : null}
        </Link>)}
      </div></div>
    </div>
    <QueryStatus isPending={summary.isPending} error={summary.error} />
    {s || c ? <div className={`${styles.status} ${s && !s.complete ? styles.warning : styles.muted}`}>
      <p>{s ? `${s.complete ? t('cluster.complete') : t('cluster.partial')} · ${t('cluster.observed')} ${new Date(s.finishedAt).toLocaleString()}` : null}{s && c ? ' · ' : null}{c ? t('cluster.metrics.capacityObserved', { time: new Date(c.observedAt).toLocaleString(), state: t(`cluster.metricState.${c.state}`) }) : null}</p>
      <details><summary>{t('cluster.strip.more')}</summary>
        {s ? <><h3>{t('cluster.sources')}</h3>{s.sources.map((source) => <p key={source.key}>{source.namespace || '*'} / {source.kind} · {t(`cluster.source.${source.state}`)} · {source.state === 'error' || source.state === 'unsupported' ? '—' : source.count}{source.reason ? ` · ${source.reason}` : ''}</p>)}</> : null}
        {c ? <CapacityDetails data={c} /> : null}
      </details>
    </div> : null}
  </section>;
}
