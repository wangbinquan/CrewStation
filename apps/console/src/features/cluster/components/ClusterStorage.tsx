import type { ClusterResource, ClusterUsage } from '@crewstation/contracts';
import { useT } from '../../../shared/lib/useT';
import { Button } from '../../../shared/ui/Button';
import { DataTable } from '../../../shared/ui/DataTable';
import { Ownership, ClusterTable } from './ClusterTable';
import { amount, MetricValue, percent } from './MetricValue';
import styles from './Metrics.module.css';

export function ClusterStorage({ rows, usages, select }: { rows: ClusterResource[]; usages: ClusterUsage[]; select: (row: ClusterResource) => void }) {
  const t = useT(), pvcs = rows.filter((r) => r.kind === 'PersistentVolumeClaim'), config = rows.filter((r) => r.kind !== 'PersistentVolumeClaim');
  return <>{pvcs.length ? <><DataTable className={styles.table} columns={[t('cluster.resource'), t('cluster.owner'), t('cluster.metrics.storageRequested'), t('cluster.metrics.storageCapacity'), t('cluster.metrics.storageUsed'), t('cluster.metrics.storageRatio'), t('cluster.metrics.storageClass'), t('cluster.metrics.mounts')]}>{pvcs.map((r) => {
    const usage = usages.find((u) => u.resourceId === r.resourceId && u.uid === r.uid), storage = usage?.storage;
    return <tr key={r.uid}><td><Button variant="ghost" data-cluster-resource={r.resourceId} onClick={() => select(r)}>{r.name}</Button><small>{r.namespace} · {r.phase}</small></td><td><Ownership row={r} /></td><td>{amount(storage?.requested)}</td><td>{amount(storage?.capacity)}</td><td><MetricValue metric={usage?.metrics.volumeUsed} /></td><td>{percent(usage?.metrics.volumeUsed?.value, storage?.capacity)}{storage && !storage.hardQuota ? <small>{t('cluster.metrics.notHardQuota')}</small> : null}</td><td>{storage?.storageClass ?? r.facts.storageClass ?? '—'}<small>{storage?.accessModes.join(', ')} · {storage?.volumeMode}</small></td><td>{storage?.mounts.length ? storage.mounts.map((m) => <small key={m.resourceId}>{m.name} · {m.node}</small>) : t('cluster.metrics.unmounted')}{usage?.node ? <small>{usage.node}</small> : null}</td></tr>;
  })}</DataTable><p className={styles.caption}>{t('cluster.metrics.storageHint')}</p></> : null}{config.length ? <ClusterTable rows={config} select={select} /> : null}</>;
}
