import type { ClusterContainer, ClusterResource, ClusterUsage } from '@crewstation/contracts';
import { api } from '../../../shared/api/client';
import { queryKeys } from '../../../shared/api/queryKeys';
import { useApiQuery } from '../../../shared/api/useApi';
import { useT } from '../../../shared/lib/useT';
import { DataTable } from '../../../shared/ui/DataTable';
import { QueryStatus } from '../../../shared/ui/QueryStatus';
import { amount, MetricValue, percent } from './MetricValue';
import { ResourceBudgetTable } from './ResourceBudgetTable';
import { ClusterHistory } from './ClusterHistory';
import styles from './Metrics.module.css';

function ResourceList({ values }: { values: Record<string, string> }) {
  const t = useT(); return Object.keys(values).length ? <>{Object.entries(values).map(([name, value]) => <small key={name}>{name}: {value}</small>)}</> : <small>{t('cluster.metrics.notSet')}</small>;
}
export function ContainerResources({ containers, node }: { containers: (ClusterUsage['containers'][number] | ClusterContainer)[]; node?: string }) {
  const t = useT();
  return <DataTable className={styles.table} columns={[t('cluster.container'), t('cluster.kind'), t('cluster.image'), t('cluster.status'), t('cluster.metrics.requests'), t('cluster.metrics.limits'), t('cluster.metrics.actual'), t('cluster.metrics.node')]}>{containers.map((c) => <tr key={c.name}><td>{c.name}</td><td>{t(`cluster.containerType.${c.type ?? ('init' in c && c.init ? 'init' : 'application')}`)}</td><td className={styles.code}>{c.image}</td><td>{c.state}{'reason' in c && c.reason ? <small>{c.reason}</small> : null}{'restarts' in c ? <small>{t('cluster.restarts', { count: c.restarts })}</small> : null}{'startedAt' in c && c.startedAt ? <small>{new Date(c.startedAt).toLocaleString()}</small> : null}</td><td><ResourceList values={c.requests} /></td><td><ResourceList values={c.limits} /></td><td>{(['cpu', 'memory', 'ephemeralStorage'] as const).map((metric) => <div key={metric}><small>{t(`cluster.metric.${metric}`)}</small><MetricValue metric={'metrics' in c ? c.metrics[metric] : undefined} compact /></div>)}</td><td>{node || t('cluster.metrics.unscheduled')}</td></tr>)}</DataTable>;
}
export function ClusterResourceMetrics({ resource, view }: { resource: ClusterResource; view: 'overview' | 'containers' | 'history' }) {
  const t = useT(), supported = resource.kind === 'Pod' || resource.kind === 'PersistentVolumeClaim';
  const query = useApiQuery(queryKeys.cluster('usage', resource.resourceId), () => api.cluster.usage({ resourceIds: [resource.resourceId] }), { enabled: supported, refetchIntervalMs: 15_000 });
  const usage = query.data?.items.find((u) => u.uid === resource.uid), storage = usage?.storage;
  if (view === 'containers') return <ContainerResources containers={usage?.containers.map((c) => ({ ...resource.containers.find((r) => r.name === c.name), ...c })) ?? resource.containers} node={usage?.node ?? resource.node} />;
  if (!supported) return null;
  if (view === 'history') return <ClusterHistory scope={resource.kind === 'Pod' ? 'pod' : 'pvc'} resourceId={resource.resourceId} containers={resource.kind === 'Pod' ? resource.containers.map((c) => c.name) : []} />;
  return <div className={styles.stack}><QueryStatus isPending={query.isPending} error={query.error} />{usage ? <>
    {resource.kind === 'Pod' ? <><p>{t('cluster.metrics.node')}: {usage.node || t('cluster.metrics.unscheduled')} · QoS: {usage.qos || '—'} · {usage.containers.length} {t('cluster.container')}</p><ResourceBudgetTable demand={usage.demand} /><div className={styles.split}>{(['cpu', 'memory', 'ephemeralStorage', 'networkRx', 'networkTx'] as const).map((metric) => <article key={metric}><strong>{t(`cluster.metric.${metric}`)}</strong><br /><MetricValue metric={usage.metrics[metric]} /></article>)}</div>{usage.hostNetwork ? <p>{t('cluster.metrics.hostNetwork')}</p> : null}{Object.keys(usage.podRequests ?? {}).length || Object.keys(usage.podLimits ?? {}).length ? <details><summary>{t('cluster.metrics.podBudget')}</summary><p>{t('cluster.metrics.requests')}</p><ResourceList values={usage.podRequests ?? {}} /><p>{t('cluster.metrics.limits')}</p><ResourceList values={usage.podLimits ?? {}} /></details> : null}</> : null}
    {storage ? <><div className={styles.split}><article>{t('cluster.metrics.storageRequested')} <strong>{amount(storage.requested)}</strong></article><article>{t('cluster.metrics.storageCapacity')} <strong>{amount(storage.capacity)}</strong></article><article>{t('cluster.metrics.storageUsed')} <MetricValue metric={usage.metrics.volumeUsed} /> · {percent(usage.metrics.volumeUsed?.value, storage.capacity)}</article></div><p>{storage.storageClass} · {storage.accessModes.join(', ')} · {storage.volumeMode} · {storage.volumeName}</p><p>{storage.source}</p><p>{storage.mounts.map((m) => `${m.name} (${m.node})`).join(', ') || t('cluster.metrics.unmounted')}</p><p className={styles.caption}>{t('cluster.metrics.storageHint')}</p></> : null}
  </> : null}</div>;
}
